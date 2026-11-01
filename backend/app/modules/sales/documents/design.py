"""Document design: which PDF template, accent colour, font and letterhead blocks.

Stored per workspace in ``<data-dir>/document_design.json``. Same contract as
the business settings: reads never raise, a bad value falls back to its default.
"""

from __future__ import annotations

import json
import logging
import re
from pathlib import Path
from typing import Any

from app.core.demo_seed import resolve_data_dir

logger = logging.getLogger(__name__)

FILENAME = "document_design.json"
TEMPLATES = ("classic", "modern", "compact")
#: DejaVu Sans is bundled (Bitstream Vera licence); Helvetica and Times are the
#: PDF standard faces, referenced not embedded, so they carry no font licence.
FONTS = ("dejavu_sans", "helvetica", "times")
LOGO_POSITIONS = ("left", "center", "right")
LOGO_SIZES = ("small", "medium", "large")
FOOTER_BLOCKS = ("address", "contact", "legal", "bank")
MAX_TERMS = 2000
_HEX = re.compile(r"^#[0-9a-fA-F]{6}$")

DEFAULT_DESIGN: dict[str, Any] = {
    "template": "classic",
    "accent_color": "#1f3a5f",
    "font": "dejavu_sans",
    "logo_position": "right",
    "logo_size": "medium",
    "footer_blocks": list(FOOTER_BLOCKS),
    "header_contact": False,
    "page_numbers": True,
    "din5008": True,
    "fold_marks": True,
    "terms_text": "",
}


def design_path(data_dir: Path | None = None) -> Path:
    base = Path(data_dir).expanduser() if data_dir is not None else resolve_data_dir()
    return base / FILENAME


def sanitise_design(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    out = {**DEFAULT_DESIGN, "footer_blocks": list(FOOTER_BLOCKS)}
    for key, allowed in (
        ("template", TEMPLATES),
        ("font", FONTS),
        ("logo_position", LOGO_POSITIONS),
        ("logo_size", LOGO_SIZES),
    ):
        if raw.get(key) in allowed:
            out[key] = raw[key]
    if isinstance(raw.get("accent_color"), str) and _HEX.match(raw["accent_color"]):
        out["accent_color"] = raw["accent_color"].lower()
    blocks = raw.get("footer_blocks")
    if isinstance(blocks, list):
        out["footer_blocks"] = [b for b in FOOTER_BLOCKS if b in blocks]
    for key in ("header_contact", "page_numbers", "din5008", "fold_marks"):
        if isinstance(raw.get(key), bool):
            out[key] = raw[key]
    if isinstance(raw.get("terms_text"), str):
        out["terms_text"] = raw["terms_text"].strip()[:MAX_TERMS]
    return out


def read_design(data_dir: Path | None = None) -> dict[str, Any]:
    path = design_path(data_dir)
    try:
        return sanitise_design(json.loads(path.read_text(encoding="utf-8")))
    except FileNotFoundError:
        return sanitise_design({})
    except (OSError, ValueError):
        logger.warning("document design at %s unreadable; using defaults", path)
        return sanitise_design({})


def write_design(updates: dict[str, Any], data_dir: Path | None = None) -> dict[str, Any]:
    merged = {**read_design(data_dir), **{k: v for k, v in updates.items() if v is not None}}
    clean = sanitise_design(merged)
    path = design_path(data_dir)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(clean, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)
    return clean
