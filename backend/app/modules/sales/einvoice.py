# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Map an issued sales invoice onto the inputs of the EN 16931 e-invoice engine.

The engine takes plain dicts and a ``defaults`` floor. The finance route fills
them from a finance invoice; this module fills the same shapes from a
``SalesDocument`` so both screens are judged by the same rules and written by
the same renderers.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.leitweg import contact_leitweg_id
from app.modules.contacts.models import Contact
from app.modules.finance.einvoice_parties import buyer_party_from_contact
from app.modules.finance.einvoice_settings_service import einvoice_defaults
from app.modules.gl.templates import zero_rate_kind
from app.modules.sales.models import SalesDocument

#: 0 % invoices, by the kind the tax note declares. A plain exemption with a note
#: is E; with no note at all nothing is claimed, so the line stays Z and the
#: engine reports the missing reason instead of inventing one.
_ZERO_CATEGORY = {"reverse_charge": "AE", "intra_eu": "K", "small_business": "E"}
_EXEMPTING = frozenset({"E", "AE", "K"})
_EL_TO_GR = {"EL": "GR"}


def line_vat_category(rate: Decimal, tax_note: str) -> str:
    """EN 16931 VAT category (BT-151) of one line."""
    if rate > 0:
        return "S"
    note = (tax_note or "").strip()
    if not note:
        return "Z"
    return _ZERO_CATEGORY.get(zero_rate_kind(note), "E")


def _line_dicts(doc: SalesDocument) -> list[dict[str, Any]]:
    out = []
    for ln in doc.lines:
        qty = Decimal(ln.qty or 0)
        net = Decimal(ln.net or 0)
        # BT-146 is the net price after discount; the line total (BT-131) stays
        # the stored net so the document reconciles with what the PDF printed.
        price = (
            ln.unit_price if not ln.discount_pct or qty == 0 else (net / qty).quantize(Decimal("0.0001"), ROUND_HALF_UP)
        )
        rate = Decimal(ln.tax_rate or 0)
        out.append(
            {
                "description": ln.description or ln.sku,
                # Sales lines carry no unit; BT-130 is mandatory, so they are counted as pieces (C62).
                "unit": "pcs",
                "quantity": qty,
                "unit_rate": price,
                "amount": net,
                "vat_rate": rate,
                "vat_category": line_vat_category(rate, doc.tax_note),
            }
        )
    return out


def _document_buyer(doc: SalesDocument) -> dict[str, str]:
    """What the invoice itself says about the buyer; the contact record overrides it."""
    vat_id = (doc.customer_vat_id or "").strip()
    prefix = vat_id[:2].upper()
    fields = {
        "name": (doc.customer_name or "").strip(),
        "vat_id": vat_id,
        "line1": ", ".join(p.strip() for p in (doc.customer_address or "").splitlines() if p.strip()),
        "country_code": _EL_TO_GR.get(prefix, prefix) if prefix.isalpha() else "",
    }
    return {k: v for k, v in fields.items() if v}


async def einvoice_inputs(
    session: AsyncSession, doc: SalesDocument
) -> tuple[dict[str, Any], list[dict[str, Any]], dict[str, Any]]:
    """Return ``(invoice, line_items, defaults)`` for the e-invoice engine."""
    lines = _line_dicts(doc)
    ei: dict[str, Any] = {}
    buyer_reference = (doc.buyer_reference or "").strip()
    if not buyer_reference and doc.customer_id:
        buyer_reference = await contact_leitweg_id(session, doc.customer_id)
    if buyer_reference:
        ei["buyer_reference"] = buyer_reference
    if (doc.payment_terms or "").strip():
        ei["payment_terms"] = doc.payment_terms.strip()
    # The reason belongs to the exempting groups only; stating it on a document
    # with none would contradict its own standard-rated lines (BR-S-10).
    if (doc.tax_note or "").strip() and any(ln["vat_category"] in _EXEMPTING for ln in lines):
        ei["vat_exemption_reason"] = doc.tax_note.strip()

    invoice = {
        "invoice_number": doc.number,
        "invoice_direction": "receivable",
        "invoice_date": doc.doc_date.isoformat(),
        "due_date": doc.due_date.isoformat() if doc.due_date else None,
        "currency_code": doc.currency,
        "amount_subtotal": doc.net_total,
        "tax_amount": doc.tax_total,
        "retention_amount": Decimal(0),
        "amount_total": doc.gross_total,
        "notes": doc.notes,
        "metadata": {"einvoice": ei},
    }

    defaults = await einvoice_defaults(session)
    buyer = _document_buyer(doc)
    if doc.customer_id:
        contact = (await session.execute(select(Contact).where(Contact.id == doc.customer_id))).scalar_one_or_none()
        if contact is not None:
            buyer.update(buyer_party_from_contact(contact))
    if buyer:
        defaults = {**defaults, "buyer": {**(defaults.get("buyer") or {}), **buyer}}
    return invoice, lines, defaults
