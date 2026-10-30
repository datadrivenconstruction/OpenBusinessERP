"""Simple PDF for purchase orders and supplier bills, built on the sales document helpers."""

from __future__ import annotations

import io
from typing import Any

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.platypus import SimpleDocTemplate, Spacer, Table, TableStyle

from app.modules.sales.documents.i18n import fmt_date, fmt_money, fmt_qty
from app.modules.sales.documents.pdf import ACCENT, RULE, _p, _styles

TITLES = {"order": "Purchase order", "bill": "Supplier bill", "credit_note": "Supplier credit note"}


def filename(kind: str, number: str) -> str:
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in number)
    return f"{kind}-{safe}.pdf"


def render_pdf(doc: Any, kind: str, company: dict[str, Any]) -> bytes:
    """``doc`` is a PurchasingOrder (kind='order') or PurchasingBill (kind='bill' | 'credit_note')."""
    lg, cur, st = "en", doc.currency, _styles()
    buf = io.BytesIO()
    page = SimpleDocTemplate(buf, pagesize=A4, leftMargin=25 * mm, rightMargin=20 * mm, topMargin=20 * mm, bottomMargin=20 * mm)
    story: list[Any] = []
    if company.get("company_name"):
        story += [_p(company["company_name"], st["bold"]), _p(company.get("address", ""), st["small"]), Spacer(1, 6 * mm)]
    story += [_p(f"{TITLES[kind]} {doc.number}", st["title"]), Spacer(1, 4 * mm)]
    meta = [
        ["Supplier", doc.supplier_name],
        ["Date", fmt_date(doc.doc_date, lg)],
        ["Expected delivery" if kind == "order" else "Due date", fmt_date(doc.due_date, lg) if doc.due_date else ""],
    ]
    if kind != "order" and doc.supplier_ref:
        meta.append(["Supplier reference", doc.supplier_ref])
    story += [Table([[_p(a, st["small"]), _p(b, st["body"])] for a, b in meta], colWidths=[40 * mm, 100 * mm]), Spacer(1, 6 * mm)]

    rows = [[_p(h, st["head"]) for h in ("#", "Item", "Qty", "Unit price", "VAT %", "Net")]]
    for ln in doc.lines:
        rows.append(
            [
                _p(str(ln.line_no), st["cell"]),
                _p((f"{ln.sku} " if ln.sku else "") + ln.description, st["cell"]),
                _p(fmt_qty(ln.qty, lg), st["cell"]),
                _p(fmt_money(ln.unit_price, cur, lg), st["cell"]),
                _p(fmt_qty(ln.tax_rate, lg), st["cell"]),
                _p(fmt_money(ln.net, cur, lg), st["cell"]),
            ]
        )
    table = Table(rows, colWidths=[8 * mm, 62 * mm, 18 * mm, 28 * mm, 14 * mm, 25 * mm], repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
                ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ]
        )
    )
    totals = [
        ["Total net", fmt_money(doc.net_total, cur, lg)],
        ["VAT", fmt_money(doc.tax_total, cur, lg)],
        ["Total", fmt_money(doc.gross_total, cur, lg)],
    ]
    story += [
        table,
        Spacer(1, 4 * mm),
        Table([[_p(a, st["bold"]), _p(b, st["bold"])] for a, b in totals], colWidths=[125 * mm, 30 * mm]),
    ]
    if doc.notes:
        story += [Spacer(1, 6 * mm), _p(doc.notes, st["body"])]
    page.build(story)
    return buf.getvalue()
