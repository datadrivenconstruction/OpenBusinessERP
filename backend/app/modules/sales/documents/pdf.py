"""Render sales documents, dunning letters and purchase orders as A4 PDFs.

Three templates (classic, modern, compact) share one engine; the workspace's
document design (:mod:`.design`) picks the template, accent colour, font, logo
placement and footer blocks. Layout follows the public DIN 5008 geometry (form
B address window, fold and punch marks); the design and wording are this
project's own. Fonts come from :mod:`app.core.pdf_fonts`, the QR code is
reportlab's built-in encoder. CII/ZUGFeRD embedding happens after rendering
and does not depend on the template.
"""

from __future__ import annotations

import base64
import io
import re
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal
from functools import lru_cache
from types import SimpleNamespace
from typing import Any
from xml.sax.saxutils import escape

from reportlab.graphics.barcode.qr import QrCodeWidget
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
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

from app.core.pdf_fonts import font_can_draw_all, pdf_font, pdf_font_for_text, pdf_shaping_for_text
from app.modules.sales.documents.design import read_design, sanitise_design
from app.modules.sales.documents.girocode import GiroCodeError, epc_payload
from app.modules.sales.documents.i18n import RTL_LANGUAGES, fmt_date, fmt_money, fmt_qty, fmt_rate, lang, t

W, H = A4
LEFT = 25 * mm
RIGHT = 20 * mm
ACCENT = colors.HexColor("#1f3a5f")
MUTED = colors.HexColor("#5b6470")
RULE = colors.HexColor("#c9ced6")
ZEBRA = colors.HexColor("#f4f6f8")
_RTL = re.compile("[֐-ࣿיִ-﷿ﹰ-ﻼ]")
_ASCII_SAFE = frozenset({"Helvetica", "Helvetica-Bold", "Times-Roman", "Times-Bold", "DejaVuSans", "DejaVuSans-Bold"})
_LOGO_BOX = {"small": (40 * mm, 12 * mm), "medium": (60 * mm, 18 * mm), "large": (80 * mm, 26 * mm)}


def _faces(font: str) -> tuple[str, str]:
    if font == "times":
        return "Times-Roman", "Times-Bold"
    if font == "helvetica":
        return "Helvetica", "Helvetica-Bold"
    return pdf_font("Helvetica"), pdf_font("Helvetica-Bold")


def _styles(design: dict[str, Any] | None = None) -> dict[str, ParagraphStyle]:
    d = sanitise_design(design)
    body, bold = _faces(d["font"])
    accent = colors.HexColor(d["accent_color"])
    s = 8.5 if d["template"] == "compact" else 9.5
    title = {"classic": 15, "modern": 20, "compact": 13}[d["template"]]
    return {
        "body": ParagraphStyle("body", fontName=body, fontSize=s, leading=s * 1.32),
        "small": ParagraphStyle("small", fontName=body, fontSize=s - 2, leading=(s - 2) * 1.27, textColor=MUTED),
        "cell": ParagraphStyle("cell", fontName=body, fontSize=s - 1, leading=(s - 1) * 1.24),
        "num": ParagraphStyle("num", fontName=body, fontSize=s - 1, leading=(s - 1) * 1.24, alignment=TA_RIGHT),
        "numb": ParagraphStyle("numb", fontName=bold, fontSize=s - 1, leading=(s - 1) * 1.24, alignment=TA_RIGHT),
        "head": ParagraphStyle(
            "head", fontName=bold, fontSize=s - 1.5, leading=(s - 1.5) * 1.25, textColor=colors.white
        ),
        "headr": ParagraphStyle(
            "headr",
            fontName=bold,
            fontSize=s - 1.5,
            leading=(s - 1.5) * 1.25,
            textColor=colors.white,
            alignment=TA_RIGHT,
        ),
        "title": ParagraphStyle("title", fontName=bold, fontSize=title, leading=title * 1.27, textColor=accent),
        "bold": ParagraphStyle("bold", fontName=bold, fontSize=s, leading=s * 1.32),
        "boldr": ParagraphStyle("boldr", fontName=bold, fontSize=s, leading=s * 1.32, alignment=TA_RIGHT),
        "bodyr": ParagraphStyle("bodyr", fontName=body, fontSize=s, leading=s * 1.32, alignment=TA_RIGHT),
    }


@lru_cache(maxsize=4096)
def _face_for(face: str, text: str) -> tuple[str, bool]:
    if text.isascii() and face in _ASCII_SAFE:
        return face, False
    if not font_can_draw_all(face, text):
        face = pdf_font_for_text(text, bold="Bold" in face, base=face)
    return face, bool(_RTL.search(text)) or pdf_shaping_for_text(text, base=face)


def _fit(text: str, style: ParagraphStyle) -> ParagraphStyle:
    """Same style, swapped to a face that can draw ``text`` and shaped when it needs it."""
    face, shaping = _face_for(style.fontName, text)
    if face == style.fontName and not shaping:
        return style
    return ParagraphStyle(f"{style.name}~", parent=style, fontName=face, shaping=1 if shaping else 0)


def _p(text: str, style: ParagraphStyle) -> Paragraph:
    text = text or ""
    return Paragraph(escape(text).replace("\n", "<br/>"), _fit(text, style))


def _logo(data_url: str) -> ImageReader | None:
    if not data_url or not data_url.startswith("data:image/") or ";base64," not in data_url:
        return None
    try:
        return ImageReader(io.BytesIO(base64.b64decode(data_url.split(",", 1)[1])))
    except Exception:  # noqa: BLE001 - a broken logo must not stop the document
        return None


def _iban_spaced(iban: str) -> str:
    return " ".join(iban[i : i + 4] for i in range(0, len(iban), 4)) if iban else ""


def _footer_columns(company: dict[str, Any], lg: str, blocks: list[str]) -> list[list[str]]:
    c = company
    cols: dict[str, list[str]] = {
        "address": [c.get("company_name", ""), *(c.get("address", "") or "").splitlines()],
        "contact": [x for x in (c.get("phone", ""), c.get("email", ""), c.get("website", "")) if x],
        "legal": [],
        "bank": [x for x in (c.get("bank_name", ""), _iban_spaced(c.get("iban", "")), c.get("bic", "")) if x],
    }
    if c.get("register_court") or c.get("register_number"):
        cols["legal"].append(
            f"{t(lg, 'register')}: {c.get('register_court', '')} {c.get('register_number', '')}".strip()
        )
    if c.get("managing_directors"):
        cols["legal"].append(f"{t(lg, 'directors')}: {c['managing_directors']}")
    if c.get("vat_id"):
        cols["legal"].append(f"{t(lg, 'vat_id')}: {c['vat_id']}")
    if c.get("tax_number"):
        cols["legal"].append(f"{t(lg, 'tax_number')}: {c['tax_number']}")
    return [col for b in blocks if any(col := [x for x in cols.get(b, []) if x])]


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


@dataclass
class _Line:
    line_no: int
    description: str
    sku: str
    qty: Decimal
    unit_price: Decimal
    discount_pct: Decimal
    tax_rate: Decimal
    net: Decimal
    tax: Decimal


def _lines(objs: Any) -> list[_Line]:
    return [
        _Line(
            int(getattr(o, "line_no", i + 1) or i + 1),
            getattr(o, "description", "") or "",
            getattr(o, "sku", "") or "",
            Decimal(getattr(o, "qty", 0) or 0),
            Decimal(getattr(o, "unit_price", 0) or 0),
            Decimal(getattr(o, "discount_pct", 0) or 0),
            Decimal(getattr(o, "tax_rate", 0) or 0),
            Decimal(getattr(o, "net", 0) or 0),
            Decimal(getattr(o, "tax", 0) or 0),
        )
        for i, o in enumerate(objs or [])
    ]


@dataclass
class _Kit:
    """Everything a story builder needs: styles, colours and formatting for one render."""

    design: dict[str, Any]
    lg: str
    currency: str
    st: dict[str, ParagraphStyle] = field(init=False)
    accent: Any = field(init=False)

    def __post_init__(self) -> None:
        self.st = _styles(self.design)
        self.accent = colors.HexColor(self.design["accent_color"])
        if self.lg in RTL_LANGUAGES:
            for key in ("body", "small", "cell", "title", "bold"):
                self.st[key].alignment = TA_RIGHT

    @property
    def template(self) -> str:
        return self.design["template"]

    @property
    def frame_w(self) -> float:
        return W - LEFT - RIGHT

    def money(self, v: Decimal | int | float) -> str:
        return fmt_money(v, self.currency, self.lg)

    def tint(self, amount: float) -> Any:
        a = self.accent
        return colors.Color(1 - (1 - a.red) * amount, 1 - (1 - a.green) * amount, 1 - (1 - a.blue) * amount)

    def head_style(self) -> tuple[ParagraphStyle, ParagraphStyle]:
        if self.template == "classic":
            return self.st["head"], self.st["headr"]
        colour = self.accent
        return (
            ParagraphStyle("headA", parent=self.st["head"], textColor=colour),
            ParagraphStyle("headAr", parent=self.st["headr"], textColor=colour),
        )

    def table_style(self, n_rows: int, special: list[int]) -> TableStyle:
        pad = 1.6 if self.template == "compact" else 3
        cmds: list[tuple[Any, ...]] = [
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), pad),
            ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
            ("LEFTPADDING", (0, 0), (-1, -1), 3),
            ("RIGHTPADDING", (0, 0), (-1, -1), 3),
        ]
        if self.template == "classic":
            cmds += [("BACKGROUND", (0, 0), (-1, 0), self.accent), ("LINEBELOW", (0, 1), (-1, -1), 0.4, RULE)]
        elif self.template == "modern":
            cmds += [
                ("BACKGROUND", (0, 0), (-1, 0), self.tint(0.12)),
                ("LINEBELOW", (0, 0), (-1, 0), 1.2, self.accent),
            ]
            cmds += [("BACKGROUND", (0, r), (-1, r), ZEBRA) for r in range(2, n_rows, 2)]
        else:
            cmds += [
                ("LINEABOVE", (0, 0), (-1, 0), 0.8, self.accent),
                ("LINEBELOW", (0, 0), (-1, 0), 0.8, self.accent),
                ("LINEBELOW", (0, 1), (-1, -1), 0.25, RULE),
            ]
        for r in special:
            cmds += [("BACKGROUND", (0, r), (-1, r), self.tint(0.07)), ("LINEABOVE", (0, r), (-1, r), 0.6, MUTED)]
        return TableStyle(cmds)


class _CarryTable(Table):
    """Line table that, when split over pages, closes each page with the running
    net total and opens the next with it (DIN-style "Übertrag")."""

    def __init__(
        self,
        kit: _Kit,
        head: list[str],
        widths: list[float],
        rows: list[list[Any]],
        amounts: list[Decimal],
        carry_in: Decimal | None = None,
        carry_out: Decimal | None = None,
    ) -> None:
        self._kit, self._head, self._widths = kit, head, widths
        self._rows, self._amounts, self._carry_in = rows, amounts, carry_in
        st = kit.st
        hl, hr = kit.head_style()
        data: list[list[Any]] = [[_p(h, hl if i < 2 else hr) for i, h in enumerate(head)]]
        special: list[int] = []
        if carry_in is not None:
            special.append(len(data))
            data.append(self._sum_row(t(kit.lg, "carry_in"), carry_in))
        data += rows
        if carry_out is not None:
            special.append(len(data))
            data.append(self._sum_row(t(kit.lg, "carry_out"), carry_out))
        super().__init__(data, colWidths=widths, repeatRows=1)
        self.setStyle(kit.table_style(len(data), special))

    def _sum_row(self, label: str, value: Decimal) -> list[Any]:
        n = len(self._head)
        return ["", _p(label, self._kit.st["bold"]), *[""] * (n - 3), _p(self._kit.money(value), self._kit.st["numb"])]

    def split(self, availWidth: float, availHeight: float) -> list[Any]:  # noqa: N803 - reportlab API
        reserve = self._kit.st["cell"].leading + 8
        cls = type(self)
        self.__class__ = Table  # reportlab rebuilds parts via self.__class__ with Table's signature
        try:
            parts = Table.split(self, availWidth, availHeight - reserve)
        finally:
            self.__class__ = cls
        if len(parts) < 2:
            return parts
        fitted = len(parts[0]._cellvalues) - 1 - (1 if self._carry_in is not None else 0)
        if fitted <= 0:
            return []
        base = self._carry_in or Decimal(0)
        running = base + sum(self._amounts[:fitted], Decimal(0))
        return [
            cls(
                self._kit,
                self._head,
                self._widths,
                self._rows[:fitted],
                self._amounts[:fitted],
                self._carry_in,
                carry_out=running,
            ),
            cls(self._kit, self._head, self._widths, self._rows[fitted:], self._amounts[fitted:], carry_in=running),
        ]


def _line_table(kit: _Kit, lines: list[_Line]) -> _CarryTable:
    lg = kit.lg
    show_disc = any(ln.discount_pct for ln in lines)
    head = [t(lg, "pos"), t(lg, "description"), t(lg, "qty"), t(lg, "unit_price")]
    head += [t(lg, "discount")] if show_disc else []
    head += [t(lg, "rate"), t(lg, "amount")]
    rows: list[list[str]] = []
    for ln in lines:
        row = [
            str(ln.line_no),
            ln.description + (f"\n{ln.sku}" if ln.sku else ""),
            fmt_qty(ln.qty, lg),
            kit.money(ln.unit_price),
        ]
        row += [fmt_rate(ln.discount_pct, lg)] if show_disc else []
        row += [fmt_rate(ln.tax_rate, lg), kit.money(ln.net)]
        rows.append([_p(row[0], kit.st["cell"]), _p(row[1], kit.st["cell"]), *(_p(c, kit.st["num"]) for c in row[2:])])
    fixed = [10 * mm, None, 16 * mm, 26 * mm] + ([14 * mm] if show_disc else []) + [14 * mm, 28 * mm]
    rest = kit.frame_w - sum(x for x in fixed if x)
    widths = [x if x else rest for x in fixed]
    return _CarryTable(kit, head, widths, rows, [ln.net for ln in lines])


def _totals(kit: _Kit, lines: list[_Line], net_total: Decimal, gross_total: Decimal, grand_label: str) -> Any:
    lg, st = kit.lg, kit.st
    by_rate: dict[Decimal, list[Decimal]] = {}
    for ln in lines:
        acc = by_rate.setdefault(ln.tax_rate, [Decimal(0), Decimal(0)])
        acc[0] += ln.net
        acc[1] += ln.tax
    rows: list[list[Any]] = [[_p(t(lg, "net_total"), st["body"]), _p(kit.money(net_total), st["bodyr"])]]
    for rate in sorted(by_rate):
        net, tax = by_rate[rate]
        label = t(lg, "tax_line", rate=fmt_rate(rate, lg), net=kit.money(net))
        rows.append([_p(label, st["body"]), _p(kit.money(tax), st["bodyr"])])
    rows.append([_p(grand_label, st["bold"]), _p(kit.money(gross_total), st["boldr"])])
    tot = Table(rows, colWidths=[72 * mm, 32 * mm], hAlign="LEFT" if lg in RTL_LANGUAGES else "RIGHT")
    cmds: list[tuple[Any, ...]] = [("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]
    if kit.template == "modern":
        white_b = ParagraphStyle("gw", parent=st["bold"], textColor=colors.white)
        white_r = ParagraphStyle("gwr", parent=st["boldr"], textColor=colors.white)
        rows[-1] = [_p(grand_label, white_b), _p(kit.money(gross_total), white_r)]
        tot = Table(rows, colWidths=[72 * mm, 32 * mm], hAlign=tot.hAlign)
        cmds += [
            ("BACKGROUND", (0, -1), (-1, -1), kit.accent),
            ("TOPPADDING", (0, -1), (-1, -1), 4),
            ("BOTTOMPADDING", (0, -1), (-1, -1), 4),
        ]
    else:
        cmds += [("LINEABOVE", (0, -1), (-1, -1), 0.8, kit.accent)]
        if kit.template == "classic":
            cmds += [("LINEBELOW", (0, -1), (-1, -1), 0.8, kit.accent)]
    tot.setStyle(TableStyle(cmds))
    return KeepTogether([tot])


def _qr_drawing(payload: str, size: float) -> Drawing:
    widget = QrCodeWidget(payload, barLevel="M")
    x1, y1, x2, y2 = widget.getBounds()
    d = Drawing(size, size, transform=[size / (x2 - x1), 0, 0, size / (y2 - y1), 0, 0])
    d.add(widget)
    return d


def _payment_block(
    kit: _Kit,
    company: dict[str, Any],
    *,
    doc_date: date,
    due: date | None,
    amount: Decimal,
    reference: str,
    terms_line: str | None = None,
) -> list[Any]:
    lg, st = kit.lg, kit.st
    days = int(company.get("payment_terms_days") or 0)
    due = due or (doc_date + timedelta(days=days) if days else None)
    terms = (
        terms_line
        or company.get("payment_terms_text")
        or (t(lg, "terms_days", days=(due - doc_date).days, due=fmt_date(due, lg)) if due else t(lg, "terms_now"))
    )
    iban = company.get("iban", "")
    bank: list[str] = []
    if iban:
        bank = [f"{t(lg, 'account_holder')}: {company.get('company_name', '')}", f"IBAN: {_iban_spaced(iban)}"]
        if company.get("bic"):
            bank.append(f"BIC: {company['bic']}")
        if company.get("bank_name"):
            bank.append(company["bank_name"])
    text: list[Any] = [_p(t(lg, "payment_terms"), st["bold"]), _p(terms, st["body"])]
    if bank:
        text += [Spacer(1, 2 * mm), _p(t(lg, "bank"), st["bold"]), _p("\n".join(bank), st["body"])]
    qr = None
    if iban and company.get("giro_code", True) and kit.currency.upper() == "EUR" and amount > 0:
        try:
            payload = epc_payload(
                name=company.get("company_name", ""),
                iban=iban,
                bic=company.get("bic", ""),
                amount=amount,
                remittance=reference,
            )
            qr = _qr_drawing(payload, 26 * mm if kit.template == "compact" else 28 * mm)
        except GiroCodeError:
            qr = None
    if qr is None:
        return [KeepTogether(text)]
    cell = Table([[qr], [_p(t(lg, "qr"), st["small"])]], colWidths=[34 * mm])
    cells = [cell, text] if lg in RTL_LANGUAGES else [text, cell]
    widths = [36 * mm, kit.frame_w - 36 * mm] if lg in RTL_LANGUAGES else [kit.frame_w - 36 * mm, 36 * mm]
    block = Table([cells], colWidths=widths)
    block.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    return [KeepTogether([block])]


def _online_payment_block(kit: _Kit, url: str) -> list[Any]:
    """Provider checkout link (Stripe / Mollie) with a QR code; printed below the bank details."""
    st = kit.st
    safe = url.replace("&", "&amp;").replace("<", "").replace(">", "").replace('"', "")
    text = [_p(t(kit.lg, "pay_online"), st["bold"]), Paragraph(f'<link href="{safe}">{safe}</link>', st["small"])]
    block = Table([[text, _qr_drawing(url, 22 * mm)]], colWidths=[kit.frame_w - 30 * mm, 30 * mm])
    block.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"), ("LEFTPADDING", (0, 0), (-1, -1), 0)]))
    return [Spacer(1, 3 * mm), KeepTogether([block])]


def _terms(kit: _Kit) -> list[Any]:
    text = kit.design.get("terms_text") or ""
    if not text:
        return []
    return [Spacer(1, 5 * mm), _p(t(kit.lg, "terms"), kit.st["bold"]), _p(text, kit.st["small"])]


def _design_of(company: dict[str, Any]) -> dict[str, Any]:
    raw = company.get("document_design")
    return sanitise_design(raw) if isinstance(raw, dict) else read_design()


def _draw(
    c: rl_canvas.Canvas,
    text: str,
    x: float,
    y: float,
    face: str,
    size: float,
    colour: Any,
    align: str = "left",
    width: float = 90 * mm,
) -> None:
    """Canvas text that still gets the face fallback and shaping a Paragraph would."""
    if not text:
        return
    if font_can_draw_all(face, text) and not _RTL.search(text):
        c.setFont(face, size)
        c.setFillColor(colour)
        {"left": c.drawString, "right": c.drawRightString, "center": c.drawCentredString}[align](x, y, text)
        return
    style = _fit(
        text,
        ParagraphStyle(
            "cv",
            fontName=face,
            fontSize=size,
            leading=size * 1.2,
            textColor=colour,
            alignment={"left": TA_LEFT, "right": TA_RIGHT, "center": TA_CENTER}[align],
        ),
    )
    para = Paragraph(escape(text), style)
    _, h = para.wrapOn(c, width, size * 3)
    left = {"left": x, "right": x - width, "center": x - width / 2}[align]
    para.drawOn(c, left, y - h + size)


def _render(
    company: dict[str, Any],
    kit: _Kit,
    *,
    title: str,
    number: str,
    recipient: list[str],
    info: list[tuple[str, str]],
    story: list[Any],
) -> bytes:
    d, lg = kit.design, kit.lg
    body_font, bold_font = kit.st["body"].fontName, kit.st["bold"].fontName
    logo = _logo(company.get("logo_data_url", ""))
    footer_cols = _footer_columns(company, lg, d["footer_blocks"])
    footer_extra = company.get("footer_text", "")
    compact = kit.template == "compact"
    footer_h = (24 if compact else 30) * mm if footer_cols or footer_extra else 16 * mm
    band = 6 * mm if kit.template == "modern" else 0

    def letterhead(c: rl_canvas.Canvas) -> None:
        top = H - 10 * mm - band
        mw, mh = _LOGO_BOX[d["logo_size"]]
        pos = d["logo_position"]
        anchor = {"left": LEFT, "center": W / 2, "right": W - RIGHT}[pos]
        if logo:
            iw, ih = logo.getSize()
            scale = min(mw / iw, mh / ih)
            lw, lh = iw * scale, ih * scale
            x = {"left": anchor, "center": anchor - lw / 2, "right": anchor - lw}[pos]
            c.drawImage(logo, x, top - lh, lw, lh, mask="auto")
        else:
            size = 13 if compact else 15
            _draw(c, company.get("company_name", ""), anchor, top - size, bold_font, size, kit.accent, pos)
        if d["header_contact"]:
            side = "left" if pos == "right" else "right"
            x = LEFT if side == "left" else W - RIGHT
            lines = [company.get("company_name", ""), *(company.get("address", "") or "").splitlines()]
            lines += [
                x_ for x_ in (company.get("phone", ""), company.get("email", ""), company.get("website", "")) if x_
            ]
            y = top - 3 * mm
            for line in [ln for ln in lines if ln][:7]:
                _draw(c, line[:70], x, y, body_font, 7, MUTED, side)
                y -= 3.2 * mm

    def first_page(c: rl_canvas.Canvas) -> None:
        if d["fold_marks"]:
            c.setStrokeColor(RULE)
            c.setLineWidth(0.5)
            for y in (H - 105 * mm, H - 210 * mm):
                c.line(4 * mm, y, 9 * mm, y)
            c.line(4 * mm, H / 2, 11 * mm, H / 2)
        letterhead(c)
        # DIN 5008 form B: return-address zone 45-50 mm, recipient 50-90 mm from top, 20 mm from the left edge.
        y = H - 50 * mm
        if d["din5008"]:
            sender = " · ".join(
                x for x in [company.get("company_name", ""), *(company.get("address", "") or "").splitlines()] if x
            )
            _draw(c, sender[:110], LEFT, H - 49 * mm, body_font, 6.5, MUTED, width=85 * mm)
            c.setStrokeColor(RULE)
            c.setLineWidth(0.5)
            c.line(LEFT, H - 50 * mm, LEFT + 80 * mm, H - 50 * mm)
            y = H - 55 * mm
        for line in [ln for ln in recipient if ln][:7]:
            _draw(c, line[:60], LEFT, y, body_font, 10, colors.black, width=80 * mm)
            y -= 4.6 * mm
        y = H - 50 * mm
        for label, value in info:
            _draw(c, label, 125 * mm, y, body_font, 8, MUTED, width=30 * mm)
            _draw(c, value, W - RIGHT, y, bold_font, 8.5, colors.black, "right", width=50 * mm)
            y -= 5 * mm

    def furniture(c: rl_canvas.Canvas, page: int, total: int) -> None:
        c.saveState()
        if band:
            c.setFillColor(kit.accent)
            c.rect(0, H - band, W, band, stroke=0, fill=1)
        if page == 1:
            first_page(c)
        else:
            _draw(c, f"{title} {number}", LEFT, H - 12 * mm - band, body_font, 8, MUTED, width=120 * mm)
            c.setStrokeColor(RULE)
            c.line(LEFT, H - 14 * mm - band, W - RIGHT, H - 14 * mm - band)
        c.setStrokeColor(kit.accent if kit.template == "modern" else RULE)
        c.setLineWidth(0.6 if kit.template == "modern" else 0.5)
        c.line(LEFT, footer_h, W - RIGHT, footer_h)
        size = 6.2 if compact else 6.8
        width = kit.frame_w / max(1, len(footer_cols))
        for i, col in enumerate(footer_cols):
            y = footer_h - 4 * mm
            for line in col[:5]:
                _draw(c, line[:52], LEFT + i * width, y, body_font, size, MUTED, width=width - 2 * mm)
                y -= (2.8 if compact else 3.2) * mm
        if footer_extra:
            _draw(c, footer_extra[:140], LEFT, 7 * mm, body_font, size, MUTED, width=130 * mm)
        if d["page_numbers"]:
            _draw(c, t(lg, "page", n=page, m=total), W - RIGHT, 7 * mm, body_font, size, MUTED, "right", 40 * mm)
        c.restoreState()

    buf = io.BytesIO()
    bottom = footer_h + 4 * mm
    first = Frame(LEFT, bottom, kit.frame_w, H - 98 * mm - bottom, id="first", showBoundary=0)
    later = Frame(LEFT, bottom, kit.frame_w, H - 20 * mm - band - bottom, id="later", showBoundary=0)
    template = BaseDocTemplate(
        buf,
        pagesize=A4,
        title=f"{title} {number}",
        author=company.get("company_name", ""),
        creator="OpenBusinessERP",
        lang=lg,
    )
    template.addPageTemplates(
        [
            PageTemplate(id="First", frames=[first], autoNextPageTemplate="Later"),
            PageTemplate(id="Later", frames=[later]),
        ]
    )
    canvasmaker = type("_DocCanvas", (_NumberedCanvas,), {"furniture": staticmethod(furniture)})
    template.build(story, canvasmaker=canvasmaker)
    return buf.getvalue()


def render_document(
    doc: Any,
    company: dict[str, Any],
    *,
    language: str | None = None,
    source_number: str | None = None,
    payment_url: str | None = None,
) -> bytes:
    """Quote, order confirmation, invoice or credit note (``doc`` is a SalesDocument)."""
    lg = lang(language or doc.language)
    kit = _Kit(_design_of(company), lg, doc.currency)
    st = kit.st
    texts = (company.get("document_texts") or {}).get(doc.kind, {})
    title = t(lg, doc.kind)
    lines = _lines(doc.lines)

    info = [(t(lg, "number"), doc.number), (t(lg, "date"), fmt_date(doc.doc_date, lg))]
    if doc.delivery_date and doc.delivery_end:
        info.append((t(lg, "delivery_period"), f"{fmt_date(doc.delivery_date, lg)} – {fmt_date(doc.delivery_end, lg)}"))
    elif doc.delivery_date:
        info.append((t(lg, "delivery_date"), fmt_date(doc.delivery_date, lg)))
    if doc.customer_vat_id:
        info.append((t(lg, "customer_vat"), doc.customer_vat_id))

    story: list[Any] = [_p(f"{title} {doc.number}", st["title"]), Spacer(1, 3 * mm)]
    if source_number:
        story += [_p(t(lg, "relates_to", ref=source_number), st["small"]), Spacer(1, 2 * mm)]
    story += [_p(texts.get("intro") or t(lg, f"intro.{doc.kind}"), st["body"]), Spacer(1, 4 * mm)]
    story += [_line_table(kit, lines), Spacer(1, 4 * mm)]
    grand = t(lg, "credit_total") if doc.kind == "credit_note" else t(lg, "gross_total")
    story += [_totals(kit, lines, doc.net_total, doc.gross_total, grand), Spacer(1, 4 * mm)]
    if doc.tax_note:
        story += [_p(doc.tax_note, st["body"]), Spacer(1, 3 * mm)]
    if doc.notes:
        story += [_p(doc.notes, st["body"]), Spacer(1, 3 * mm)]
    if doc.kind == "invoice":
        story += _payment_block(
            kit,
            company,
            doc_date=doc.doc_date,
            due=doc.due_date,
            amount=doc.gross_total - (doc.amount_paid or 0),
            reference=doc.number,
        )
        if payment_url:
            story += _online_payment_block(kit, payment_url)
    story += [Spacer(1, 3 * mm), _p(texts.get("closing") or t(lg, f"closing.{doc.kind}"), st["body"])]
    story += _terms(kit)
    recipient = [doc.customer_name, *(doc.customer_address or "").splitlines()]
    return _render(company, kit, title=title, number=doc.number, recipient=recipient, info=info, story=story)


def render_dunning(
    doc: Any, company: dict[str, Any], *, level: int = 1, language: str | None = None, today: date | None = None
) -> bytes:
    """Payment reminder (level 1) or numbered dunning letter for an open invoice."""
    lg = lang(language or doc.language)
    kit = _Kit(_design_of(company), lg, doc.currency)
    st = kit.st
    level = max(1, min(int(level), 9))
    title = t(lg, "dunning.1") if level == 1 else t(lg, "dunning", n=level)
    today = today or date.today()
    paid = Decimal(doc.amount_paid or 0)
    balance = Decimal(doc.gross_total) - paid
    info = [(t(lg, "date"), fmt_date(today, lg)), (t(lg, "invoice"), doc.number)]
    head = [
        t(lg, "invoice"),
        t(lg, "invoice_date"),
        t(lg, "due_date"),
        t(lg, "gross_total"),
        t(lg, "amount_paid"),
        t(lg, "balance_due"),
    ]
    hl, hr = kit.head_style()
    row = [
        doc.number,
        fmt_date(doc.doc_date, lg),
        fmt_date(doc.due_date, lg),
        kit.money(doc.gross_total),
        kit.money(paid),
        kit.money(balance),
    ]
    data = [
        [_p(h, hl if i < 3 else hr) for i, h in enumerate(head)],
        [_p(v, st["cell"] if i < 3 else (st["numb"] if i == 5 else st["num"])) for i, v in enumerate(row)],
    ]
    table = Table(data, colWidths=[kit.frame_w * w for w in (0.2, 0.15, 0.15, 0.17, 0.15, 0.18)])
    table.setStyle(kit.table_style(2, []))
    story: list[Any] = [
        _p(title, st["title"]),
        Spacer(1, 4 * mm),
        _p(t(lg, "intro.dunning"), st["body"]),
        Spacer(1, 4 * mm),
        table,
        Spacer(1, 5 * mm),
    ]
    story += _payment_block(
        kit, company, doc_date=today, due=today + timedelta(days=7), amount=balance, reference=doc.number
    )
    story += [Spacer(1, 3 * mm), _p(t(lg, "closing.dunning"), st["body"])]
    recipient = [doc.customer_name, *(doc.customer_address or "").splitlines()]
    return _render(company, kit, title=title, number=doc.number, recipient=recipient, info=info, story=story)


def render_purchase(doc: Any, kind: str, company: dict[str, Any], *, language: str | None = None) -> bytes:
    """Purchase order (``kind='order'``), supplier bill or supplier credit note."""
    lg = lang(language or getattr(doc, "language", None) or "en")
    kit = _Kit(_design_of(company), lg, doc.currency)
    st = kit.st
    key = {"order": "purchase_order", "bill": "bill", "credit_note": "supplier_credit_note"}[kind]
    title = t(lg, key)
    lines = _lines(doc.lines)
    info = [(t(lg, "number"), doc.number), (t(lg, "date"), fmt_date(doc.doc_date, lg))]
    if doc.due_date:
        info.append((t(lg, "expected_delivery" if kind == "order" else "due_date"), fmt_date(doc.due_date, lg)))
    if kind != "order" and getattr(doc, "supplier_ref", ""):
        info.append((t(lg, "supplier_ref"), doc.supplier_ref))
    story: list[Any] = [_p(f"{title} {doc.number}", st["title"]), Spacer(1, 3 * mm)]
    if intro := t(lg, f"intro.{key}"):
        story += [_p(intro, st["body"]), Spacer(1, 4 * mm)]
    story += [_line_table(kit, lines), Spacer(1, 4 * mm)]
    story += [_totals(kit, lines, doc.net_total, doc.gross_total, t(lg, "gross_total")), Spacer(1, 4 * mm)]
    if doc.notes:
        story += [_p(doc.notes, st["body"]), Spacer(1, 3 * mm)]
    if closing := t(lg, f"closing.{key}"):
        story += [Spacer(1, 3 * mm), _p(closing, st["body"])]
    if kind == "order":
        story += _terms(kit)
    recipient = [doc.supplier_name, *(getattr(doc, "supplier_address", "") or "").splitlines()]
    return _render(company, kit, title=title, number=doc.number, recipient=recipient, info=info, story=story)


# ── Sample data for the design preview and the golden tests ───────────────
_SAMPLE_ITEMS = {
    "en": ("Site survey and measurement", "Concrete C25/30, delivered", "Formwork rental (weekly)", "Labour, skilled"),
    "de": ("Aufmaß und Vermessung vor Ort", "Beton C25/30, frei Baustelle", "Schalungsmiete (Woche)", "Facharbeiter"),
    "ar": ("مسح الموقع والقياس", "خرسانة C25/30 مع التوصيل", "تأجير القوالب (أسبوعي)", "عمالة ماهرة"),
}
_SAMPLE_CUSTOMER = {
    "en": ("Example Construction Ltd", "Attn. Accounts Payable\n12 Harbour Road\nLondon SE1 9AA"),
    "de": ("Musterbau GmbH", "z. Hd. Buchhaltung\nHafenstraße 12\n20457 Hamburg"),
    "ar": ("شركة البناء النموذجية", "قسم الحسابات\nشارع الميناء 12\nدبي"),
}


def sample_document(kind: str = "invoice", language: str = "en", n_lines: int = 6, currency: str = "EUR") -> Any:
    """A SalesDocument-shaped stand-in with realistic data, never persisted."""
    lg = language if language in _SAMPLE_ITEMS else "en"
    items = _SAMPLE_ITEMS[lg]
    lines = []
    for i in range(n_lines):
        qty = Decimal(1 + (i * 7) % 12)
        price = Decimal(45 + (i * 37) % 400) + Decimal("0.50")
        rate = Decimal(7) if i % 4 == 3 else Decimal(19)
        net = (qty * price).quantize(Decimal("0.01"))
        tax = (net * rate / 100).quantize(Decimal("0.01"))
        lines.append(
            SimpleNamespace(
                line_no=i + 1,
                description=f"{items[i % len(items)]} {i + 1}",
                sku=f"ART-{1000 + i}",
                qty=qty,
                unit_price=price,
                discount_pct=Decimal(0),
                tax_rate=rate,
                net=net,
                tax=tax,
            )
        )
    net_total = sum((ln.net for ln in lines), Decimal(0))
    tax_total = sum((ln.tax for ln in lines), Decimal(0))
    name, address = _SAMPLE_CUSTOMER[lg]
    prefix = {"quote": "QUO", "order": "ORD", "invoice": "INV", "credit_note": "CRN"}.get(kind, "DOC")
    return SimpleNamespace(
        kind=kind,
        language=lg,
        currency=currency,
        number=f"{prefix}-2026-0042",
        lines=lines,
        customer_name=name,
        customer_address=address,
        customer_vat_id="DE123456789",
        doc_date=date(2026, 3, 2),
        due_date=date(2026, 3, 16),
        delivery_date=date(2026, 2, 27),
        delivery_end=None,
        net_total=net_total,
        tax_total=tax_total,
        gross_total=net_total + tax_total,
        amount_paid=Decimal(0),
        tax_note="",
        notes="",
        supplier_name=name,
        supplier_address=address,
        supplier_ref="SR-778",
    )


def render_sample(kind: str, company: dict[str, Any], *, language: str = "en", n_lines: int = 6) -> bytes:
    """Render a sample of ``kind`` (sales kinds, ``dunning`` or ``purchase_order``) with ``company``'s design."""
    if kind == "dunning":
        return render_dunning(sample_document("invoice", language, n_lines), company, level=1, today=date(2026, 4, 1))
    if kind == "purchase_order":
        return render_purchase(sample_document("order", language, n_lines), "order", company, language=language)
    return render_document(sample_document(kind, language, n_lines), company)
