"""Check an invoice for the data §14 (4) UStG lists for German invoices.

A plausibility check, not legal advice: it reports what looks missing so the
user can fill it in before issuing or sending.
"""

from __future__ import annotations

from typing import Any

from app.modules.sales.models import SalesDocument

INVOICE_KINDS = {"invoice", "credit_note"}


def check_invoice(doc: SalesDocument, company: dict[str, Any]) -> list[dict[str, str]]:
    """Return ``[{field, message}]`` for missing mandatory invoice data; empty when complete."""
    if doc.kind not in INVOICE_KINDS:
        return []
    issues: list[dict[str, str]] = []

    def miss(field: str, message: str) -> None:
        issues.append({"field": field, "message": message})

    if not (company.get("company_name") or "").strip():
        miss("company_name", "Seller name is missing (Settings > Company details & documents).")
    if not (company.get("address") or "").strip():
        miss("company_address", "Seller address is missing (Settings > Company details & documents).")
    if not (company.get("tax_number") or company.get("vat_id")):
        miss("tax_id", "Seller tax number or VAT ID is missing.")
    if not (doc.customer_name or "").strip():
        miss("customer_name", "Customer name is missing.")
    if not (doc.customer_address or "").strip():
        miss("customer_address", "Customer address is missing.")
    if not doc.doc_date:
        miss("doc_date", "Invoice date is missing.")
    if not (doc.number or "").strip():
        miss("number", "Sequential invoice number is missing.")
    if not doc.delivery_date:
        miss("delivery_date", "Delivery date or service period is missing.")
    if not doc.lines:
        miss("lines", "The invoice has no positions.")
    for ln in doc.lines:
        if not (ln.description or "").strip():
            miss(f"line_{ln.line_no}", f"Position {ln.line_no} has no description.")
        if ln.qty is None or ln.qty <= 0:
            miss(f"line_{ln.line_no}_qty", f"Position {ln.line_no} has no quantity.")
    if any(ln.tax_rate == 0 for ln in doc.lines) and not (doc.tax_note or "").strip():
        miss("tax_note", "A 0 % line needs a note on the tax exemption or reverse charge.")
    if (doc.tax_note or "").strip() and not (doc.customer_vat_id or "").strip() and "reverse" in doc.tax_note.lower():
        miss("customer_vat_id", "Reverse charge usually needs the customer's VAT ID.")
    return issues
