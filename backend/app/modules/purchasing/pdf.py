"""Simple PDF for purchase orders and supplier bills, built on the sales document helpers."""

from __future__ import annotations

from typing import Any

from app.modules.sales.documents.pdf import render_purchase

TITLES = {"order": "Purchase order", "bill": "Supplier bill", "credit_note": "Supplier credit note"}


def filename(kind: str, number: str) -> str:
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in number)
    return f"{kind}-{safe}.pdf"


def render_pdf(doc: Any, kind: str, company: dict[str, Any], *, language: str | None = None) -> bytes:
    """``doc`` is a PurchasingOrder (kind='order') or PurchasingBill (kind='bill' | 'credit_note')."""
    return render_purchase(doc, kind, company, language=language)
