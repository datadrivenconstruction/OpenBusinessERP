"""Render quotes, order confirmations, invoices and credit notes as A4 PDFs.

Layout follows the public DIN 5008 geometry (form B address window, fold and
punch marks); the design and wording are this project's own. Fonts are the
bundled DejaVu faces from :mod:`app.core.pdf_fonts`, the QR code is reportlab's
built-in encoder.
"""

from __future__ import annotations

import base64
import io
from datetime import timedelta
from decimal import Decimal
from typing import Any
from xml.sax.saxutils import escape

from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.lib.utils import ImageReader
from reportlab.pdfgen import canvas as rl_canvas
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    KeepTogether,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)

from app.core.pdf_fonts import pdf_font
from app.modules.sales.documents.girocode import GiroCodeError, epc_payload
from app.modules.sales.documents.i18n import fmt_date, fmt_money, fmt_qty, fmt_rate, lang, t
from app.modules.sales.models import SalesDocument

W, H = A4
LEFT = 25 * mm
RIGHT = 20 * mm
ACCENT = colors.HexColor("#1f3a5f")
MUTED = colors.HexColor("#5b6470")
RULE = colors.HexColor("#c9ced6")
FOOTER_H = 30 * mm


def _styles() -> dict[str, ParagraphStyle]:
    body, bold = pdf_font("Helvetica"), pdf_font("Helvetica-Bold")
    return {
        "body": ParagraphStyle("body", fontName=body, fontSize=9.5, leading=12.5),
        "small": ParagraphStyle("small", fontName=body, fontSize=7.5, leading=9.5, textColor=MUTED),
        "cell": ParagraphStyle("cell", fontName=body, fontSize=8.5, leading=10.5),
        "head": ParagraphStyle("head", fontName=bold, fontSize=8, leading=10, textColor=colors.white),
        "title": ParagraphStyle("title", fontName=bold, fontSize=15, leading=19, textColor=ACCENT),
        "bold": ParagraphStyle("bold", fontName=bold, fontSize=9.5, leading=12.5),
    }


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    return Paragraph(escape(text).replace("\n", "<br/>"), style)


def _logo(data_url: str) -> ImageReader | None:
    if not data_url.startswith("data:image/") or ";base64," not in data_url:
        return None
    try:
        return ImageReader(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))
    except Exception:  # noqa: BLE001 - a broken logo must not stop the document
        return None


def _footer_columns(company: dict[str, Any], lg: str) -> list[list[str]]:
    c = company
    col1 = [c.get("company_name", ""), *(c.get("address", "") or "").splitlines()]
    col2 = [x for x in (c.get("phone", ""), c.get("email", ""), c.get("website", "")) if x]
    col3 = []
    if c.get("register_court") or c.get("register_number"):
        col3.append(f"{t(lg, 'register')}: {c.get('register_court', '')} {c.get('register_number', '')}".strip())
    if c.get("managing_directors"):
        col3.append(f"{t(lg, 'directors')}: {c['managing_directors']}")
    if c.get("vat_id"):
        col3.append(f"{t(lg, 'vat_id')}: {c['vat_id']}")
    if c.get("tax_number"):
        col3.append(f"{t(lg, 'tax_number')}: {c['tax_number']}")
    col4 = [x for x in (c.get("bank_name", ""), _iban_spaced(c.get("iban", "")), c.get("bic", "")) if x]
    return [col for col in (col1, col2, col3, col4) if any(col)]


def _iban_spaced(iban: str) -> str:
    return " ".join(iban[i : i + 4] for i in range(0, len(iban), 4)) if iban else ""


class _NumberedCanvas(rl_canvas.Canvas):
    """Defers page furniture until the page count is known ("Page n of m")."""

    furniture: Any = None

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._pages: list[dict[str, Any]] = []

    def showPage(self) -> None:  # noqa: N802 - reportlab API
        self._pages.append(dict(self.__dict__))
        self._startPage()

    def save(self) -> None:
        total = len(self._pages)
        for state in self._pages:
            self.__dict__.update(state)
            if self.furniture:
                self.furniture(self, self._pageNumber, total)
            super().showPage()
        super().save()


def render_document(
    doc: SalesDocument,
    company: dict[str, Any],
    *,
    language: str | None = None,
    source_number: str | None = None,
) -> bytes:
    lg = lang(language or doc.language)
    st = _styles()
    cur = doc.currency
    texts = (company.get("document_texts") or {}).get(doc.kind, {})
    title = t(lg, doc.kind)
    body_font, bold_font = st["body"].fontName, st["bold"].fontName
    logo = _logo(company.get("logo_data_url", ""))
    footer_cols = _footer_columns(company, lg)
    footer_extra = company.get("footer_text", "")

    def first_page(c: rl_canvas.Canvas) -> None:
        # Fold and punch marks (DIN 5008 form B).
        c.setStrokeColor(RULE)
        c.setLineWidth(0.5)
        for y in (H - 105 * mm, H - 210 * mm):
            c.line(4 * mm, y, 9 * mm, y)
        c.line(4 * mm, H / 2, 11 * mm, H / 2)
        if logo:
            iw, ih = logo.getSize()
            scale = min(60 * mm / iw, 22 * mm / ih)
            c.drawImage(logo, W - RIGHT - iw * scale, H - 12 * mm - ih * scale, iw * scale, ih * scale, mask="auto")
        else:
            c.setFont(bold_font, 14)
            c.setFillColor(ACCENT)
            c.drawRightString(W - RIGHT, H - 22 * mm, company.get("company_name", ""))
        # Return-address line above the window, then the recipient block.
        sender = " · ".join(
            x for x in [company.get("company_name", ""), *(company.get("address", "") or "").splitlines()] if x
        )
        c.setFont(body_font, 6.5)
        c.setFillColor(MUTED)
        c.drawString(LEFT, H - 50 * mm, sender[:110])
        c.setStrokeColor(RULE)
        c.line(LEFT, H - 51 * mm, LEFT + 85 * mm, H - 51 * mm)
        c.setFillColor(colors.black)
        c.setFont(body_font, 10)
        y = H - 56 * mm
        for line in [doc.customer_name, *(doc.customer_address or "").splitlines()][:7]:
            c.drawString(LEFT, y, line[:60])
            y -= 4.6 * mm
        # Information block to the right of the window.
        rows = [(t(lg, "number"), doc.number), (t(lg, "date"), fmt_date(doc.doc_date, lg))]
        if doc.delivery_date and doc.delivery_end:
            rows.append(
                (t(lg, "delivery_period"), f"{fmt_date(doc.delivery_date, lg)} – {fmt_date(doc.delivery_end, lg)}")
            )
        elif doc.delivery_date:
            rows.append((t(lg, "delivery_date"), fmt_date(doc.delivery_date, lg)))
        if doc.customer_vat_id:
            rows.append((t(lg, "customer_vat"), doc.customer_vat_id))
        y = H - 50 * mm
        for label, value in rows:
            c.setFont(body_font, 8)
            c.setFillColor(MUTED)
            c.drawString(125 * mm, y, label)
            c.setFont(bold_font, 8.5)
            c.setFillColor(colors.black)
            c.drawRightString(W - RIGHT, y, value)
            y -= 5 * mm

    def furniture(c: rl_canvas.Canvas, page: int, total: int) -> None:
        c.saveState()
        if page == 1:
            first_page(c)
        else:
            c.setFont(body_font, 8)
            c.setFillColor(MUTED)
            c.drawString(LEFT, H - 12 * mm, f"{title} {doc.number}")
        c.setStrokeColor(RULE)
        c.line(LEFT, FOOTER_H, W - RIGHT, FOOTER_H)
        c.setFont(body_font, 6.8)
        c.setFillColor(MUTED)
        width = (W - LEFT - RIGHT) / max(1, len(footer_cols))
        for i, col in enumerate(footer_cols):
            y = FOOTER_H - 4 * mm
            for line in col[:5]:
                c.drawString(LEFT + i * width, y, line[:48])
                y -= 3.2 * mm
        if footer_extra:
            c.drawString(LEFT, 7 * mm, footer_extra[:140])
        c.drawRightString(W - RIGHT, 7 * mm, t(lg, "page", n=page, m=total))
        c.restoreState()

    buf = io.BytesIO()
    frame_w = W - LEFT - RIGHT
    first = Frame(LEFT, FOOTER_H + 4 * mm, frame_w, H - 98 * mm - FOOTER_H - 4 * mm, id="first", showBoundary=0)
    later = Frame(LEFT, FOOTER_H + 4 * mm, frame_w, H - 20 * mm - FOOTER_H - 4 * mm, id="later", showBoundary=0)
    template = BaseDocTemplate(
        buf,
        pagesize=A4,
        title=f"{title} {doc.number}",
        author=company.get("company_name", ""),
        creator="OpenBusinessERP",
    )
    template.addPageTemplates(
        [
            PageTemplate(id="First", frames=[first], autoNextPageTemplate="Later"),
            PageTemplate(id="Later", frames=[later]),
        ]
    )

    story: list[Any] = [_p(f"{title} {doc.number}", st["title"]), Spacer(1, 3 * mm)]
    if source_number:
        story += [_p(t(lg, "relates_to", ref=source_number), st["small"]), Spacer(1, 2 * mm)]
    story += [_p(texts.get("intro") or t(lg, f"intro.{doc.kind}"), st["body"]), Spacer(1, 4 * mm)]

    # Positions table.
    show_disc = any(ln.discount_pct for ln in doc.lines)
    head = [t(lg, "pos"), t(lg, "description"), t(lg, "qty"), t(lg, "unit_price")]
    head += [t(lg, "discount")] if show_disc else []
    head += [t(lg, "rate"), t(lg, "amount")]
    data: list[list[Any]] = [[_p(h, st["head"]) for h in head]]
    for ln in doc.lines:
        desc = ln.description + (f"\n{ln.sku}" if ln.sku else "")
        row = [str(ln.line_no), _p(desc, st["cell"]), fmt_qty(ln.qty, lg), fmt_money(ln.unit_price, cur, lg)]
        row += [fmt_rate(ln.discount_pct, lg)] if show_disc else []
        row += [fmt_rate(ln.tax_rate, lg), fmt_money(ln.net, cur, lg)]
        data.append(row)
    fixed = [10 * mm, None, 16 * mm, 26 * mm] + ([14 * mm] if show_disc else []) + [14 * mm, 28 * mm]
    rest = frame_w - sum(x for x in fixed if x)
    widths = [x if x else rest for x in fixed]
    table = Table(data, colWidths=widths, repeatRows=1)
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), ACCENT),
                ("FONT", (0, 1), (-1, -1), body_font, 8.5),
                ("ALIGN", (2, 1), (-1, -1), "RIGHT"),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
                ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    story += [table, Spacer(1, 4 * mm)]

    # Tax summary per rate and totals.
    by_rate: dict[Decimal, list[Decimal]] = {}
    for ln in doc.lines:
        acc = by_rate.setdefault(Decimal(ln.tax_rate), [Decimal(0), Decimal(0)])
        acc[0] += ln.net
        acc[1] += ln.tax
    totals: list[list[str]] = [[t(lg, "net_total"), fmt_money(doc.net_total, cur, lg)]]
    for rate in sorted(by_rate):
        net, tax = by_rate[rate]
        totals.append(
            [t(lg, "tax_line", rate=fmt_rate(rate, lg), net=fmt_money(net, cur, lg)), fmt_money(tax, cur, lg)]
        )
    grand_label = t(lg, "credit_total") if doc.kind == "credit_note" else t(lg, "gross_total")
    totals.append([grand_label, fmt_money(doc.gross_total, cur, lg)])
    tot = Table(totals, colWidths=[70 * mm, 32 * mm], hAlign="RIGHT")
    tot.setStyle(
        TableStyle(
            [
                ("FONT", (0, 0), (-1, -1), body_font, 9),
                ("ALIGN", (1, 0), (1, -1), "RIGHT"),
                ("FONT", (0, -1), (-1, -1), bold_font, 10),
                ("LINEABOVE", (0, -1), (-1, -1), 0.8, ACCENT),
                ("TOPPADDING", (0, 0), (-1, -1), 2),
            ]
        )
    )
    story += [KeepTogether([tot]), Spacer(1, 4 * mm)]
    if doc.tax_note:
        story += [_p(doc.tax_note, st["body"]), Spacer(1, 3 * mm)]
    if doc.notes:
        story += [_p(doc.notes, st["body"]), Spacer(1, 3 * mm)]

    if doc.kind == "invoice":
        story += _payment_block(doc, company, lg, st)
    story += [Spacer(1, 3 * mm), _p(texts.get("closing") or t(lg, f"closing.{doc.kind}"), st["body"])]

    _NumberedCanvas.furniture = staticmethod(furniture)  # type: ignore[assignment]
    try:
        template.build(story, canvasmaker=_NumberedCanvas)
    finally:
        _NumberedCanvas.furniture = None
    return buf.getvalue()


def _payment_block(doc: SalesDocument, company: dict[str, Any], lg: str, st: dict[str, ParagraphStyle]) -> list[Any]:
    days = int(company.get("payment_terms_days") or 0)
    due = doc.due_date or (doc.doc_date + timedelta(days=days) if days else None)
    lines = [company.get("payment_terms_text") or ""]
    if not lines[0]:
        lines[0] = (
            t(lg, "terms_days", days=(due - doc.doc_date).days, due=fmt_date(due, lg)) if due else t(lg, "terms_now")
        )
    iban = company.get("iban", "")
    bank: list[str] = []
    if iban:
        bank = [
            f"{t(lg, 'account_holder')}: {company.get('company_name', '')}",
            f"IBAN: {_iban_spaced(iban)}",
        ]
        if company.get("bic"):
            bank.append(f"BIC: {company['bic']}")
        if company.get("bank_name"):
            bank.append(company["bank_name"])
    text = [_p(t(lg, "payment_terms"), st["bold"]), _p("\n".join(lines), st["body"])]
    if bank:
        text += [Spacer(1, 2 * mm), _p(t(lg, "bank"), st["bold"]), _p("\n".join(bank), st["body"])]
    qr = None
    if iban and company.get("giro_code", True) and doc.currency.upper() == "EUR" and doc.gross_total > 0:
        try:
            payload = epc_payload(
                name=company.get("company_name", ""),
                iban=iban,
                bic=company.get("bic", ""),
                amount=doc.gross_total - (doc.amount_paid or 0),
                remittance=doc.number,
            )
            qr = _qr_drawing(payload, 28 * mm)
        except GiroCodeError:
            qr = None
    if qr is None:
        return [KeepTogether(text)]
    cell = Table([[qr], [_p(t(lg, "qr"), st["small"])]], colWidths=[34 * mm])
    block = Table([[text, cell]], colWidths=[W - LEFT - RIGHT - 36 * mm, 36 * mm])
    block.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    return [KeepTogether([block])]


def _qr_drawing(payload: str, size: float) -> Drawing:
    widget = QrCodeWidget(payload, barLevel="M")
    x1, y1, x2, y2 = widget.getBounds()
    d = Drawing(size, size, transform=[size / (x2 - x1), 0, 0, size / (y2 - y1), 0, 0])
    d.add(widget)
    return d
