"""Workspace business settings - who the company is, for accounting and setup.

Country, base currency, fiscal-year start, industry profile and size. Written
by the onboarding wizard, read by finance (posting periods, tax packs) and by
the dashboard to pick defaults. One file per workspace::

    <data-dir>/business_settings.json

Same contract as :mod:`app.core.company_profile`: nothing raises on read, a
malformed value falls back to its default and nothing else is lost.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from app.core.demo_seed import resolve_data_dir

logger = logging.getLogger(__name__)

BUSINESS_SETTINGS_FILENAME = "business_settings.json"

COMPANY_SIZES = ("solo", "small", "medium", "large")

DEFAULT_BUSINESS_SETTINGS: dict[str, Any] = {
    "company_name": "",
    "country_code": "",
    "base_currency": "",
    "fiscal_year_start_month": 1,
    "industry": "",
    "company_size": "",
    # Legal / document data printed on sales documents (letterhead, footer).
    "address": "",
    "email": "",
    "phone": "",
    "website": "",
    "vat_id": "",
    "tax_number": "",
    "iban": "",
    "bic": "",
    "bank_name": "",
    "register_court": "",
    "register_number": "",
    "managing_directors": "",
    "footer_text": "",
    "payment_terms_days": 14,
    "payment_terms_text": "",
    "giro_code": True,
    "logo_data_url": "",
    "document_texts": {},
    "tax_rates": [],
}

#: Free-text legal fields and their length caps.
TEXT_FIELDS: dict[str, int] = {
    "email": 120,
    "phone": 40,
    "website": 120,
    "vat_id": 20,
    "tax_number": 30,
    "bic": 11,
    "bank_name": 80,
    "register_court": 80,
    "register_number": 40,
    "managing_directors": 160,
    "footer_text": 300,
    "payment_terms_text": 300,
}
DOC_TEXT_KINDS = ("quote", "order", "invoice", "credit_note")
DOC_TEXT_KEYS = {"intro": 1000, "closing": 1000, "email_subject": 200, "email_body": 4000}
MAX_ADDRESS_LINES = 4
MAX_TAX_RATES = 20
MAX_LOGO_CHARS = 700_000
_LOGO = re.compile(r"^data:image/(png|jpeg);base64,[A-Za-z0-9+/=]+$")
_IBAN = re.compile(r"^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$")

_COUNTRY = re.compile(r"^[A-Z]{2}$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_KEY = re.compile(r"^[a-z][a-z0-9_]{1,48}$")
MAX_COMPANY_NAME = 120


def business_settings_path(data_dir: Path | None = None) -> Path:
    base = Path(data_dir).expanduser() if data_dir is not None else resolve_data_dir()
    return base / BUSINESS_SETTINGS_FILENAME


def _clean_tax_rates(raw: Any) -> list[dict[str, Any]]:
    """Named tax rates ``[{name, rate (0-100), default}]``; at most one default."""
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        name = item.get("name")
        rate = item.get("rate")
        if not isinstance(name, str) or isinstance(rate, bool) or not isinstance(rate, (int, float)):
            continue
        name = " ".join(name.split())[:40]
        if not name or name.lower() in seen or not 0 <= rate <= 100:
            continue
        seen.add(name.lower())
        out.append({"name": name, "rate": round(float(rate), 3), "default": item.get("default") is True})
        if len(out) >= MAX_TAX_RATES:
            break
    for extra in [r for r in out if r["default"]][1:]:
        extra["default"] = False
    return out


def sanitise(raw: Any) -> dict[str, Any]:
    """Keep the valid fields of ``raw``; every other field takes its default."""
    out = dict(DEFAULT_BUSINESS_SETTINGS)
    out["document_texts"] = {}
    if not isinstance(raw, dict):
        return out
    name = raw.get("company_name")
    if isinstance(name, str):
        out["company_name"] = " ".join(name.split())[:MAX_COMPANY_NAME]
    for field, pattern in (("country_code", _COUNTRY), ("base_currency", _CURRENCY)):
        value = raw.get(field)
        if isinstance(value, str) and pattern.match(value.strip().upper()):
            out[field] = value.strip().upper()
    month = raw.get("fiscal_year_start_month")
    if isinstance(month, int) and not isinstance(month, bool) and 1 <= month <= 12:
        out["fiscal_year_start_month"] = month
    industry = raw.get("industry")
    if isinstance(industry, str) and _KEY.match(industry):
        out["industry"] = industry
    size = raw.get("company_size")
    if size in COMPANY_SIZES:
        out["company_size"] = size
    for field, cap in TEXT_FIELDS.items():
        value = raw.get(field)
        if isinstance(value, str):
            out[field] = " ".join(value.split())[:cap]
    address = raw.get("address")
    if isinstance(address, str):
        lines = [" ".join(ln.split())[:80] for ln in address.splitlines() if ln.strip()]
        out["address"] = "\n".join(lines[:MAX_ADDRESS_LINES])
    iban = raw.get("iban")
    if isinstance(iban, str):
        compact = "".join(iban.split()).upper()
        out["iban"] = compact if _IBAN.match(compact) else ""
    out["bic"] = out["bic"].replace(" ", "").upper()
    days = raw.get("payment_terms_days")
    if isinstance(days, int) and not isinstance(days, bool) and 0 <= days <= 365:
        out["payment_terms_days"] = days
    if isinstance(raw.get("giro_code"), bool):
        out["giro_code"] = raw["giro_code"]
    logo = raw.get("logo_data_url")
    if isinstance(logo, str) and len(logo) <= MAX_LOGO_CHARS and (_LOGO.match(logo) or logo == ""):
        out["logo_data_url"] = logo
    out["tax_rates"] = _clean_tax_rates(raw.get("tax_rates"))
    texts = raw.get("document_texts")
    if isinstance(texts, dict):
        clean: dict[str, dict[str, str]] = {}
        for kind in DOC_TEXT_KINDS:
            entry = texts.get(kind)
            if isinstance(entry, dict):
                kept = {
                    k: v[:cap] for k, cap in DOC_TEXT_KEYS.items() if isinstance(v := entry.get(k), str) and v.strip()
                }
                if kept:
                    clean[kind] = kept
        out["document_texts"] = clean
    return out


def read_business_settings(data_dir: Path | None = None) -> dict[str, Any]:
    path = business_settings_path(data_dir)
    try:
        return sanitise(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return sanitise({})
    except (OSError, ValueError):
        logger.warning("business settings at %s unreadable; using defaults", path)
        return sanitise({})


def write_business_settings(updates: dict[str, Any], data_dir: Path | None = None) -> dict[str, Any]:
    """Merge ``updates`` (``None`` values ignored) over the stored settings."""
    merged = {**read_business_settings(data_dir), **{k: v for k, v in updates.items() if v is not None}}
    clean = sanitise(merged)
    path = business_settings_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return clean
