"""Outbound mail (SMTP) settings edited in the business settings hub.

Stored per workspace in ``<data-dir>/mail_settings.json``; the password is
kept Fernet-encrypted (``app.core.crypto``) and never returned by the API.
An SMTP transport configured through the environment (``EMAIL_BACKEND=smtp``
plus ``SMTP_HOST``) always wins over the stored settings.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any, Literal

from app.config import Settings, get_settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.core.demo_seed import resolve_data_dir
from app.core.email.service import (
    EmailService,
    _address_belongs_to_deactivated_account,
    email_delivery_enabled,
    get_email_service,
)
from app.core.email.smtp import SmtpEmailBackend

logger = logging.getLogger(__name__)

MAIL_SETTINGS_FILENAME = "mail_settings.json"
SECURITIES = ("starttls", "ssl", "none")
Security = Literal["starttls", "ssl", "none"]

DEFAULT_MAIL_SETTINGS: dict[str, Any] = {
    "host": "",
    "port": 587,
    "security": "starttls",
    "username": "",
    "password": "",  # encrypted at rest
    "from_name": "",
    "from_address": "",
    "reply_to": "",
}
_EMAIL = re.compile(r"^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$")
_HOST = re.compile(r"^[A-Za-z0-9.-]{1,253}$")


def mail_settings_path(data_dir: Path | None = None) -> Path:
    base = Path(data_dir).expanduser() if data_dir is not None else resolve_data_dir()
    return base / MAIL_SETTINGS_FILENAME


def sanitise(raw: Any) -> dict[str, Any]:
    out = dict(DEFAULT_MAIL_SETTINGS)
    if not isinstance(raw, dict):
        return out
    host = raw.get("host")
    if isinstance(host, str) and (_HOST.match(host.strip()) or not host.strip()):
        out["host"] = host.strip()
    port = raw.get("port")
    if isinstance(port, int) and not isinstance(port, bool) and 1 <= port <= 65535:
        out["port"] = port
    if raw.get("security") in SECURITIES:
        out["security"] = raw["security"]
    for key, cap in (("username", 200), ("password", 2000), ("from_name", 120)):
        value = raw.get(key)
        if isinstance(value, str):
            out[key] = value.strip()[:cap] if key != "password" else value[:cap]
    for key in ("from_address", "reply_to"):
        value = raw.get(key)
        if isinstance(value, str) and (_EMAIL.match(value.strip()) or not value.strip()):
            out[key] = value.strip()
    return out


def _read_raw(data_dir: Path | None = None) -> dict[str, Any]:
    path = mail_settings_path(data_dir)
    try:
        return sanitise(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return sanitise({})
    except (OSError, ValueError):
        logger.warning("mail settings at %s unreadable; using defaults", path)
        return sanitise({})


def env_override(settings: Settings | None = None) -> bool:
    return email_delivery_enabled(settings or get_settings())


def read_mail_settings(data_dir: Path | None = None) -> dict[str, Any]:
    """Public view: no password, plus where the active transport comes from."""
    raw = _read_raw(data_dir)
    public = {k: v for k, v in raw.items() if k != "password"}
    public["password_set"] = bool(raw["password"])
    public.update(mail_status(data_dir))
    return public


def write_mail_settings(updates: dict[str, Any], data_dir: Path | None = None) -> dict[str, Any]:
    """Merge ``updates``; ``password`` None keeps the stored one, "" clears it."""
    current = _read_raw(data_dir)
    password = updates.get("password")
    merged = {**current, **{k: v for k, v in updates.items() if v is not None and k != "password"}}
    if password is not None:
        merged["password"] = encrypt_secret(password) if password else ""
    clean = sanitise(merged)
    path = mail_settings_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return read_mail_settings(data_dir)


def stored_smtp_settings(data_dir: Path | None = None, base: Settings | None = None) -> Settings | None:
    """App settings with the stored SMTP fields applied, or None when no host is stored."""
    raw = _read_raw(data_dir)
    if not raw["host"]:
        return None
    base = base or get_settings()
    return base.model_copy(
        update={
            "email_backend": "smtp",
            "smtp_host": raw["host"],
            "smtp_port": raw["port"],
            "smtp_tls": raw["security"] == "starttls",
            "smtp_ssl": raw["security"] == "ssl",
            "smtp_user": raw["username"],
            "smtp_password": decrypt_secret(raw["password"]) or "",
            "smtp_from": raw["from_address"] or raw["username"] or base.smtp_from,
            "smtp_from_name": raw["from_name"],
            "smtp_reply_to": raw["reply_to"],
        }
    )


def mail_status(data_dir: Path | None = None) -> dict[str, Any]:
    """``configured`` is True only when mail really leaves the building."""
    settings = get_settings()
    if env_override(settings):
        return {"configured": True, "source": "env"}
    if _read_raw(data_dir)["host"]:
        return {"configured": True, "source": "settings"}
    return {"configured": False, "source": "none"}


def mail_service(data_dir: Path | None = None) -> EmailService:
    """Email service for user-triggered business mail (documents, reminders, test mail)."""
    settings = get_settings()
    if not env_override(settings):
        stored = stored_smtp_settings(data_dir, settings)
        if stored is not None:
            return EmailService(SmtpEmailBackend(stored), is_deactivated=_address_belongs_to_deactivated_account)
    return get_email_service()
