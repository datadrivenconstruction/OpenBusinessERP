"""Online payment provider settings (Stripe / Mollie) edited in the business settings hub.

Stored per workspace in ``<data-dir>/payment_settings.json``; API keys and the
webhook signing secret are Fernet-encrypted (``app.core.crypto``) and never
returned by the API or written to logs.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.demo_seed import resolve_data_dir

logger = logging.getLogger(__name__)

PAYMENT_SETTINGS_FILENAME = "payment_settings.json"
PROVIDERS = ("none", "stripe", "mollie")
SECRET_KEYS = ("stripe_secret_key", "stripe_webhook_secret", "mollie_api_key")

DEFAULT_PAYMENT_SETTINGS: dict[str, Any] = {
    "provider": "none",
    "stripe_secret_key": "",  # encrypted at rest
    "stripe_webhook_secret": "",  # encrypted at rest
    "mollie_api_key": "",  # encrypted at rest
    "public_base_url": "",  # where the provider reaches the webhooks, e.g. https://erp.example.com
    "return_url": "",  # where the payer lands after checkout
    "clearing_account_code": "",  # GL transit account; empty = chart default (SKR03 1360) or the bank role
}
_URL = re.compile(r"^https?://[^\s<>\"']{1,500}$")
_CODE = re.compile(r"^[A-Za-z0-9._-]{0,32}$")


def payment_settings_path(data_dir: Path | None = None) -> Path:
    base = Path(data_dir).expanduser() if data_dir is not None else resolve_data_dir()
    return base / PAYMENT_SETTINGS_FILENAME


def sanitise(raw: Any) -> dict[str, Any]:
    out = dict(DEFAULT_PAYMENT_SETTINGS)
    if not isinstance(raw, dict):
        return out
    if raw.get("provider") in PROVIDERS:
        out["provider"] = raw["provider"]
    for key in SECRET_KEYS:
        if isinstance(raw.get(key), str):
            out[key] = raw[key][:4000]
    for key in ("public_base_url", "return_url"):
        value = raw.get(key)
        if isinstance(value, str) and (_URL.match(value.strip()) or not value.strip()):
            out[key] = value.strip().rstrip("/") if key == "public_base_url" else value.strip()
    code = raw.get("clearing_account_code")
    if isinstance(code, str) and _CODE.match(code.strip()):
        out["clearing_account_code"] = code.strip()
    return out


def _read_raw(data_dir: Path | None = None) -> dict[str, Any]:
    path = payment_settings_path(data_dir)
    try:
        return sanitise(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return sanitise({})
    except (OSError, ValueError):
        logger.warning("payment settings at %s unreadable; using defaults", path)
        return sanitise({})


def secrets(data_dir: Path | None = None) -> dict[str, Any]:
    """Settings with secrets decrypted; for the provider adapters only, never for a response."""
    raw = _read_raw(data_dir)
    for key in SECRET_KEYS:
        raw[key] = decrypt_secret(raw[key]) or "" if raw[key] else ""
    return raw


def test_mode(provider: str, key: str) -> bool | None:
    if not key:
        return None
    if provider == "stripe":
        return key.startswith(("sk_test_", "rk_test_"))
    if provider == "mollie":
        return key.startswith("test_")
    return None


def payment_status(data_dir: Path | None = None) -> dict[str, Any]:
    s = secrets(data_dir)
    provider = s["provider"]
    key = s["stripe_secret_key"] if provider == "stripe" else s["mollie_api_key"] if provider == "mollie" else ""
    configured = bool(key) and (provider != "stripe" or bool(s["stripe_webhook_secret"]))
    return {"provider": provider, "configured": configured, "test_mode": test_mode(provider, key)}


def read_payment_settings(data_dir: Path | None = None) -> dict[str, Any]:
    """Public view: no secrets, only whether each is set."""
    raw = _read_raw(data_dir)
    public = {k: v for k, v in raw.items() if k not in SECRET_KEYS}
    for key in SECRET_KEYS:
        public[f"{key}_set"] = bool(raw[key])
    public.update(payment_status(data_dir))
    return public


def write_payment_settings(updates: dict[str, Any], data_dir: Path | None = None) -> dict[str, Any]:
    """Merge ``updates``; a secret None keeps the stored one, "" clears it."""
    current = _read_raw(data_dir)
    merged = {**current, **{k: v for k, v in updates.items() if v is not None and k not in SECRET_KEYS}}
    for key in SECRET_KEYS:
        value = updates.get(key)
        if value is not None:
            merged[key] = encrypt_secret(value.strip()) if value.strip() else ""
    clean = sanitise(merged)
    path = payment_settings_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return read_payment_settings(data_dir)
