"""Sales service: totals, status machine, conversion, numbering, GL posting."""

from __future__ import annotations

import uuid
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_settings import read_business_settings
from app.modules.gl.fx_posting import FxRateMissingError, q_rate, rate_for, settlement, settlement_lines
from app.modules.gl.models import DEFAULT_TENANT, GLAccount, GLJournalEntry
from app.modules.gl.service import GLError, GLService, LineInput, base_currency
from app.modules.sales.models import (
    KINDS,
    SalesAccountMap,
    SalesDocument,
    SalesLine,
    SalesPayment,
    SalesSendLog,
    SalesSequence,
)

CENT = Decimal("0.01")
ZERO = Decimal(0)
HUNDRED = Decimal(100)
DERIVES = {"quote": "order", "order": "invoice"}
PREFIX = {"quote": "QT", "order": "SO", "invoice": "INV", "credit_note": "CN"}


def prefix_for(kind: str) -> str:
    """Number prefix; invoices take the workspace ``invoice_prefix`` when set."""
    if kind == "invoice":
        from app.core.business_settings import read_business_settings

        return read_business_settings().get("invoice_prefix") or PREFIX[kind]
    return PREFIX[kind]


SOURCE_INVOICE = "sales_invoice"
SOURCE_PAYMENT = "sales_payment"
SOURCE_CREDIT = "sales_credit_note"

# Allowed transitions; converted/invoiced/issued/paid are driven by service calls.
TRANSITIONS: dict[str, dict[str, set[str]]] = {
    "quote": {
        "draft": {"sent", "cancelled"},
        "sent": {"accepted", "rejected", "expired", "cancelled"},
        "accepted": {"converted"},
        "rejected": set(),
        "expired": set(),
        "cancelled": set(),
        "converted": set(),
    },
    "order": {
        "draft": {"confirmed", "cancelled"},
        "confirmed": {"delivered", "invoiced", "cancelled"},
        "delivered": {"invoiced", "cancelled"},
        "invoiced": set(),
        "cancelled": set(),
    },
    "invoice": {
        "draft": {"issued", "cancelled"},
        "issued": {"partially_paid", "paid", "cancelled"},
        "partially_paid": {"paid"},
        "paid": set(),
        "cancelled": set(),
    },
    # Issuing posts the reversal of the source invoice for the credited lines.
    "credit_note": {
        "draft": {"issued", "cancelled"},
        "issued": set(),
        "cancelled": set(),
    },
}
EXTRA_FIELDS = (
    "customer_address",
    "customer_vat_id",
    "customer_email",
    "language",
    "delivery_date",
    "delivery_end",
    "tax_note",
    "payment_terms",
)
SYSTEM_STATUSES = {"converted", "invoiced", "partially_paid", "paid"}
ROLES = ("receivable", "revenue", "vat", "bank")
# Default account codes per loaded chart template; overridden by oe_sales_account_map.
DEFAULT_ACCOUNTS: dict[str, dict[str, str]] = {
    "de_skr03": {"receivable": "1400", "revenue": "8400", "vat": "1776", "bank": "1200"},
    "ifrs_generic": {"receivable": "1400", "revenue": "4000", "vat": "2300", "bank": "1710"},
}


class SalesError(Exception):
    pass


class SalesNotFoundError(SalesError):
    pass


class SalesValidationError(SalesError):
    pass


class SalesConflictError(SalesError):
    pass


def money(v: Any) -> Decimal:
    return Decimal(str(v)).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass
class LineData:
    description: str = ""
    sku: str = ""
    qty: Decimal = Decimal(1)
    unit_price: Decimal = ZERO
    discount_pct: Decimal = ZERO
    tax_rate: Decimal | None = ZERO
    item_id: uuid.UUID | None = None


# Standard VAT/GST by ISO2 country; US and unknown -> 0 (sales tax is jurisdiction-based).
DEFAULT_TAX_RATES: dict[str, Decimal] = {
    k: Decimal(v)
    for k, v in {
        "DE": "19",
        "AT": "20",
        "CH": "8.1",
        "FR": "20",
        "IT": "22",
        "ES": "21",
        "NL": "21",
        "BE": "21",
        "PL": "23",
        "SE": "25",
        "DK": "25",
        "FI": "25.5",
        "NO": "25",
        "IE": "23",
        "PT": "23",
        "CZ": "21",
        "GB": "20",
        "RU": "20",
        "UA": "20",
        "AU": "10",
        "NZ": "15",
        "CA": "5",
        "IN": "18",
        "JP": "10",
        "SG": "9",
    }.items()
}


def default_tax_rate(country_code: str | None = None) -> Decimal:
    if country_code is None:
        country_code = read_business_settings().get("country_code")
    return DEFAULT_TAX_RATES.get(str(country_code or "").upper(), ZERO)


def line_amounts(qty: Any, unit_price: Any, discount_pct: Any, tax_rate: Any) -> tuple[Decimal, Decimal, Decimal]:
    """Per-line rounding: net and tax each rounded half-up to cents."""
    qty, unit_price = Decimal(str(qty)), Decimal(str(unit_price))
    discount_pct, tax_rate = Decimal(str(discount_pct)), Decimal(str(tax_rate))
    if qty < 0 or unit_price < 0:
        raise SalesValidationError("Quantity and unit price must be non-negative")
    if not (ZERO <= discount_pct <= HUNDRED and ZERO <= tax_rate <= HUNDRED):
        raise SalesValidationError("Discount and tax rate must be between 0 and 100")
    net = money(qty * unit_price * (HUNDRED - discount_pct) / HUNDRED)
    tax = money(net * tax_rate / HUNDRED)
    return net, tax, net + tax


def build_lines(lines: list[LineData], tenant_id: str = DEFAULT_TENANT) -> list[SalesLine]:
    out = []
    fallback: Decimal | None = None
    for i, ln in enumerate(lines, start=1):
        if ln.tax_rate is None:
            fallback = default_tax_rate() if fallback is None else fallback
            ln = replace(ln, tax_rate=fallback)
        net, tax, gross = line_amounts(ln.qty, ln.unit_price, ln.discount_pct, ln.tax_rate)
        out.append(
            SalesLine(
                tenant_id=tenant_id,
                line_no=i,
                item_id=ln.item_id,
                sku=ln.sku or "",
                description=ln.description or "",
                qty=Decimal(str(ln.qty)),
                unit_price=Decimal(str(ln.unit_price)),
                discount_pct=Decimal(str(ln.discount_pct)),
                tax_rate=Decimal(str(ln.tax_rate)),
                net=net,
                tax=tax,
                gross=gross,
            )
        )
    return out


def apply_totals(doc: SalesDocument) -> None:
    doc.net_total = sum((ln.net for ln in doc.lines), ZERO)
    doc.tax_total = sum((ln.tax for ln in doc.lines), ZERO)
    doc.gross_total = doc.net_total + doc.tax_total


def check_transition(kind: str, current: str, target: str) -> None:
    if target not in TRANSITIONS[kind].get(current, set()):
        raise SalesConflictError(f"{kind} cannot go from {current} to {target}")


class SalesService:
    def __init__(self, session: AsyncSession, tenant_id: str = DEFAULT_TENANT) -> None:
        self.session = session
        self.tenant_id = tenant_id
        self.gl = GLService(session, tenant_id)

    # ── Numbering ─────────────────────────────────────────────────────────
    async def _next_number(self, kind: str) -> str:
        seq = await self.session.scalar(
            select(SalesSequence)
            .where(SalesSequence.tenant_id == self.tenant_id, SalesSequence.kind == kind)
            .with_for_update()
        )
        if seq is None:
            seq = SalesSequence(tenant_id=self.tenant_id, kind=kind, last_number=0)
            self.session.add(seq)
        seq.last_number += 1
        await self.session.flush()
        return f"{prefix_for(kind)}-{seq.last_number:06d}"

    # ── Documents ─────────────────────────────────────────────────────────
    async def get(self, doc_id: uuid.UUID, kind: str | None = None) -> SalesDocument:
        doc = await self.session.get(SalesDocument, doc_id)
        if doc is None or doc.tenant_id != self.tenant_id or (kind and doc.kind != kind):
            raise SalesNotFoundError("Sales document not found")
        if doc.kind in DERIVES:
            await self._annotate_remaining(doc)
        return doc

    async def _converted(self, doc: SalesDocument) -> dict[int, Decimal]:
        """Quantity already carried into live derived documents, keyed by the source line_no."""
        D = SalesDocument
        rows = (
            await self.session.execute(
                select(SalesLine.line_no, func.sum(SalesLine.qty))
                .join(D, D.id == SalesLine.document_id)
                .where(
                    D.tenant_id == self.tenant_id,
                    D.source_id == doc.id,
                    D.kind == DERIVES[doc.kind],
                    D.status != "cancelled",
                )
                .group_by(SalesLine.line_no)
            )
        ).all()
        return {no: Decimal(str(q)) for no, q in rows}

    async def _annotate_remaining(self, doc: SalesDocument) -> dict[int, Decimal]:
        done = await self._converted(doc)
        remaining = {}
        for ln in doc.lines:
            remaining[ln.line_no] = ln.qty - done.get(ln.line_no, ZERO)
            ln.remaining_qty = max(ZERO, remaining[ln.line_no])
        return remaining

    def _filtered(
        self,
        kind: str,
        *,
        statuses: list[str] | None = None,
        customer_id: uuid.UUID | None = None,
        q: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        overdue: bool | None = None,
        today: date | None = None,
    ):
        D = SalesDocument
        stmt = select(D).where(D.tenant_id == self.tenant_id, D.kind == kind)
        if statuses:
            stmt = stmt.where(D.status.in_(statuses))
        if customer_id:
            stmt = stmt.where(D.customer_id == customer_id)
        if q and q.strip():
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(D.number.ilike(like), D.customer_name.ilike(like)))
        if date_from:
            stmt = stmt.where(D.doc_date >= date_from)
        if date_to:
            stmt = stmt.where(D.doc_date <= date_to)
        if overdue is not None:
            cond = (
                (D.kind == "invoice")
                & D.due_date.is_not(None)
                & (D.due_date < (today or date.today()))
                & (D.gross_total - D.amount_paid > 0)
                & D.status.not_in(("paid", "cancelled", "draft"))
            )
            stmt = stmt.where(cond if overdue else ~cond)
        return stmt

    async def query_documents(
        self, kind: str, *, sort: str = "-doc_date", limit: int = 200, offset: int = 0, **filters: Any
    ) -> tuple[list[SalesDocument], int]:
        D = SalesDocument
        stmt = self._filtered(kind, **filters)
        total = await self.session.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
        cols = {
            "number": D.number,
            "doc_date": D.doc_date,
            "due_date": D.due_date,
            "gross_total": D.gross_total,
            "balance": D.gross_total - D.amount_paid,
            "customer_name": D.customer_name,
        }
        key = sort.lstrip("-")
        if key not in cols:
            raise SalesValidationError(f"Unknown sort '{sort}'; expected one of {sorted(cols)}")
        order = cols[key].desc().nulls_last() if sort.startswith("-") else cols[key].asc().nulls_last()
        stmt = stmt.order_by(order, D.number.desc()).limit(max(1, min(limit, 1000))).offset(max(0, offset))
        return list((await self.session.execute(stmt)).scalars()), int(total)

    async def list_documents(self, kind: str, status: str | None = None, limit: int = 500) -> list[SalesDocument]:
        q = select(SalesDocument).where(SalesDocument.tenant_id == self.tenant_id, SalesDocument.kind == kind)
        if status:
            q = q.where(SalesDocument.status == status)
        q = q.order_by(SalesDocument.number.desc()).limit(limit)
        return list((await self.session.execute(q)).scalars())

    async def create(
        self,
        kind: str,
        *,
        lines: list[LineData],
        doc_date: date | None = None,
        created_by: str | None = None,
        **data: Any,
    ) -> SalesDocument:
        if kind not in KINDS:
            raise SalesValidationError(f"Unknown kind {kind}")
        doc = SalesDocument(
            tenant_id=self.tenant_id,
            kind=kind,
            number=await self._next_number(kind),
            status="draft",
            doc_date=doc_date or date.today(),
            created_by=created_by,
            customer_id=data.get("customer_id"),
            customer_name=data.get("customer_name") or "",
            currency=(data.get("currency") or "EUR").upper(),
            fx_rate=await self._rate(data.get("currency") or "EUR", doc_date, data.get("fx_rate")),
            due_date=data.get("due_date"),
            notes=data.get("notes") or "",
            source_id=data.get("source_id"),
            amount_paid=ZERO,
            **{k: data[k] for k in EXTRA_FIELDS if data.get(k) is not None},
        )
        doc.lines = build_lines(lines, self.tenant_id)
        doc.payments = []
        apply_totals(doc)
        self.session.add(doc)
        await self.session.flush()
        return doc

    async def update(self, doc_id: uuid.UUID, **data: Any) -> SalesDocument:
        doc = await self.get(doc_id)
        if doc.status != "draft":
            raise SalesConflictError(f"Only draft documents can be edited (is {doc.status})")
        lines: list[LineData] | None = data.pop("lines", None)
        for k in (
            "customer_id",
            "customer_name",
            "currency",
            "fx_rate",
            "doc_date",
            "due_date",
            "notes",
            *EXTRA_FIELDS,
        ):
            if k in data and data[k] is not None:
                setattr(doc, k, data[k].upper() if k == "currency" else data[k])
        if data.get("currency") and not data.get("fx_rate"):
            doc.fx_rate = await self._rate(doc.currency, doc.doc_date, None)
        if lines is not None:
            doc.lines.clear()
            await self.session.flush()
            doc.lines.extend(build_lines(lines, self.tenant_id))
            apply_totals(doc)
        await self.session.flush()
        return doc

    async def _rate(self, currency: str, on_date: date | None, manual: Any) -> Decimal:
        try:
            return await rate_for(self.session, currency, on_date or date.today(), manual)
        except FxRateMissingError as exc:
            raise SalesValidationError(str(exc)) from exc

    async def delete(self, doc_id: uuid.UUID) -> None:
        doc = await self.get(doc_id)
        if doc.status != "draft":
            raise SalesConflictError("Only draft documents can be deleted")
        await self.session.delete(doc)
        await self.session.flush()

    async def set_status(self, doc_id: uuid.UUID, target: str, created_by: str | None = None) -> SalesDocument:
        doc = await self.get(doc_id)
        if doc.kind == "invoice" and target == "issued":
            return await self.issue_invoice(doc_id, created_by=created_by)
        if doc.kind == "credit_note" and target == "issued":
            return await self.issue_credit_note(doc_id, created_by=created_by)
        if target in SYSTEM_STATUSES:
            raise SalesConflictError(f"Status {target} is set by conversion or payment, not directly")
        check_transition(doc.kind, doc.status, target)
        if doc.kind == "invoice" and doc.status == "issued":
            if doc.payments:
                raise SalesConflictError("Invoice has payments; cannot cancel")
            if doc.gl_entry_id:
                await self._gl(
                    self.gl.reverse_entry(doc.gl_entry_id, memo=f"Cancel {doc.number}", created_by=created_by)
                )
            await self._stock_for_invoice(doc, cancel=True, created_by=created_by)
        if doc.kind == "order" and (target == "delivered" or doc.status == "delivered"):
            await self._stock_for_delivery(doc, cancel=doc.status == "delivered", created_by=created_by)
        doc.status = target
        await self.session.flush()
        return doc

    async def _stock_for_delivery(self, doc: SalesDocument, *, cancel: bool, created_by: str | None) -> None:
        """Delivery issues stock (and COGS) through inventory; cancelling a delivered order reverses it."""
        from app.modules.inventory.service import SOURCE_DELIVERY, InventoryError, InventoryService

        inv = InventoryService(self.session, self.tenant_id)
        try:
            if cancel:
                await inv.cancel_source(SOURCE_DELIVERY, str(doc.id), created_by=created_by)
            else:
                await inv.deliver_sales_order(doc, created_by=created_by, already=await self._invoiced_stock(doc, inv))
        except InventoryError as exc:
            raise SalesConflictError(str(exc)) from exc

    async def _invoiced_stock(self, order: SalesDocument, inv: Any) -> dict[uuid.UUID, Decimal]:
        """Item -> qty already issued by invoices of this order that skipped delivery."""
        from app.modules.inventory.service import SOURCE_INVOICE_ISSUE

        out: dict[uuid.UUID, Decimal] = {}
        ids = (
            await self.session.execute(
                select(SalesDocument.id).where(
                    SalesDocument.tenant_id == self.tenant_id,
                    SalesDocument.kind == "invoice",
                    SalesDocument.source_id == order.id,
                )
            )
        ).scalars()
        for inv_id in ids:
            for m in await inv._source_moves(SOURCE_INVOICE_ISSUE, str(inv_id)):
                out[m.item_id] = out.get(m.item_id, ZERO) - Decimal(m.qty)
        return out

    async def _stock_for_invoice(self, invoice: SalesDocument, *, cancel: bool, created_by: str | None) -> None:
        """An invoice of an order that was never delivered issues its stock (and COGS) itself, exactly once."""
        from app.modules.inventory.service import (
            SOURCE_DELIVERY,
            SOURCE_INVOICE_ISSUE,
            InventoryError,
            InventoryService,
        )

        if invoice.source_id is None:
            return
        order = await self.session.get(SalesDocument, invoice.source_id)
        if order is None or order.kind != "order" or order.tenant_id != self.tenant_id:
            return
        inv = InventoryService(self.session, self.tenant_id)
        try:
            if cancel:
                await inv.cancel_source(SOURCE_INVOICE_ISSUE, str(invoice.id), created_by=created_by)
            elif not await inv._source_moves(SOURCE_DELIVERY, str(order.id)):
                await inv.deliver_sales_order(
                    invoice, created_by=created_by, on=invoice.doc_date, source_type=SOURCE_INVOICE_ISSUE
                )
        except InventoryError as exc:
            raise SalesConflictError(str(exc)) from exc

    async def _copy(
        self,
        src: SalesDocument,
        kind: str,
        created_by: str | None,
        qtys: dict[int, Decimal] | None = None,
    ) -> SalesDocument:
        """Copy ``src`` into a new draft; ``qtys`` (line_no -> qty) restricts and overrides the lines.

        Derived lines keep the source line_no so converted quantities are traceable without a new column.
        """
        chosen = [ln for ln in src.lines if qtys is None or ln.line_no in qtys]
        lines = [
            LineData(
                ln.description,
                ln.sku,
                ln.qty if qtys is None else qtys[ln.line_no],
                ln.unit_price,
                ln.discount_pct,
                ln.tax_rate,
                ln.item_id,
            )
            for ln in chosen
        ]
        doc = await self.create(
            kind,
            lines=lines,
            created_by=created_by,
            customer_id=src.customer_id,
            customer_name=src.customer_name,
            currency=src.currency,
            fx_rate=src.fx_rate,
            notes=src.notes,
            source_id=src.id,
            **{k: getattr(src, k) for k in EXTRA_FIELDS},
        )
        for ln, orig in zip(doc.lines, chosen, strict=True):
            ln.line_no = orig.line_no
        await self.session.flush()
        return doc

    async def _convert(
        self, src: SalesDocument, kind: str, created_by: str | None, selection: list[tuple[uuid.UUID, Decimal]] | None
    ) -> tuple[SalesDocument, bool]:
        remaining = await self._annotate_remaining(src)
        if selection is None:
            qtys = {no: r for no, r in remaining.items() if r > 0}
        else:
            by_id = {ln.id: ln for ln in src.lines}
            qtys = {}
            for line_id, qty in selection:
                ln = by_id.get(line_id)
                if ln is None:
                    raise SalesValidationError("Conversion references a line outside this document")
                qtys[ln.line_no] = qtys.get(ln.line_no, ZERO) + Decimal(str(qty))
            for no, qty in qtys.items():
                if qty <= 0 or qty > remaining[no]:
                    raise SalesValidationError(
                        f"Line {no}: convert between 0 and the remaining {max(ZERO, remaining[no])}"
                    )
        if not qtys and src.lines:
            raise SalesConflictError("Nothing left to convert on this document")
        doc = await self._copy(src, kind, created_by, qtys if src.lines else None)
        left = await self._annotate_remaining(src)
        return doc, all(r <= 0 for r in left.values())

    async def quote_to_order(
        self,
        quote_id: uuid.UUID,
        created_by: str | None = None,
        lines: list[tuple[uuid.UUID, Decimal]] | None = None,
    ) -> SalesDocument:
        quote = await self.get(quote_id, "quote")
        if quote.status == "sent":
            quote.status = "accepted"
        check_transition("quote", quote.status, "converted")
        order, complete = await self._convert(quote, "order", created_by, lines)
        if complete:
            quote.status = "converted"
        await self.session.flush()
        return order

    async def order_to_invoice(
        self,
        order_id: uuid.UUID,
        created_by: str | None = None,
        lines: list[tuple[uuid.UUID, Decimal]] | None = None,
    ) -> SalesDocument:
        order = await self.get(order_id, "order")
        check_transition("order", order.status, "invoiced")
        inv, complete = await self._convert(order, "invoice", created_by, lines)
        if complete:
            order.status = "invoiced"
        await self.session.flush()
        return inv

    async def duplicate(
        self, doc_id: uuid.UUID, kind: str | None = None, created_by: str | None = None
    ) -> SalesDocument:
        src = await self.get(doc_id, kind)
        today = date.today()
        return await self.create(
            src.kind,
            lines=[
                LineData(ln.description, ln.sku, ln.qty, ln.unit_price, ln.discount_pct, ln.tax_rate, ln.item_id)
                for ln in src.lines
            ],
            created_by=created_by,
            doc_date=today,
            due_date=today + (src.due_date - src.doc_date) if src.due_date else None,
            customer_id=src.customer_id,
            customer_name=src.customer_name,
            currency=src.currency,
            fx_rate=src.fx_rate,
            notes=src.notes,
            **{k: getattr(src, k) for k in EXTRA_FIELDS},
        )

    async def bulk(self, kind: str, action: str, ids: list[uuid.UUID]) -> dict[str, Any]:
        from app.modules.sales.documents import service as docs

        if action not in {"mark_sent", "delete_drafts", "reminder_drafts"}:
            raise SalesValidationError(f"Unknown action {action}")
        processed = 0
        skipped: list[dict[str, Any]] = []
        drafts: list[dict[str, Any]] = []
        company = docs.company_data() if action == "reminder_drafts" else {}
        for doc_id in dict.fromkeys(ids):
            try:
                doc = await self.get(doc_id, kind)
                if action == "mark_sent":
                    check_transition(kind, doc.status, "sent")
                    doc.status = "sent"
                elif action == "delete_drafts":
                    await self.delete(doc.id)
                else:
                    if kind != "invoice" or doc.status not in {"issued", "partially_paid"} or doc.balance_due <= 0:
                        raise SalesConflictError("Only invoices with a balance due get a reminder")
                    d = docs.email_draft(doc, company)
                    drafts.append(
                        {"id": doc.id, "number": doc.number, "to": d["to"], "subject": d["subject"], "body": d["body"]}
                    )
                processed += 1
            except SalesNotFoundError:
                skipped.append({"id": doc_id, "reason": "not found"})
            except SalesConflictError as exc:
                skipped.append({"id": doc_id, "reason": str(exc)})
        await self.session.flush()
        return {"processed": processed, "skipped": skipped, "drafts": drafts}

    async def related(self, doc_id: uuid.UUID, kind: str | None = None) -> dict[str, Any]:
        doc = await self.get(doc_id, kind)
        D = SalesDocument
        source = await self.session.get(D, doc.source_id) if doc.source_id else None
        if source is not None and source.tenant_id != self.tenant_id:
            source = None
        derived = (
            await self.session.execute(
                select(D).where(D.tenant_id == self.tenant_id, D.source_id == doc.id).order_by(D.created_at, D.number)
            )
        ).scalars()
        return {"source": source, "derived": list(derived)}

    async def activity(self, doc_id: uuid.UUID, kind: str | None = None) -> list[dict[str, Any]]:
        doc = await self.get(doc_id, kind)

        def aware(v: Any) -> datetime:
            if isinstance(v, datetime):
                return v if v.tzinfo else v.replace(tzinfo=UTC)
            return datetime(v.year, v.month, v.day, tzinfo=UTC)

        events: list[dict[str, Any]] = [
            {
                "at": aware(doc.created_at or doc.doc_date),
                "type": "created",
                "actor": doc.created_by,
                "message": f"Created {doc.number}",
                "ref_id": doc.id,
            }
        ]
        if doc.gl_entry_id:
            entry = await self.session.get(GLJournalEntry, doc.gl_entry_id)
            events.append(
                {
                    "at": aware(entry.created_at if entry is not None and entry.created_at else doc.doc_date),
                    "type": "issued",
                    "actor": None,
                    "message": f"Issued {doc.number} and posted to the general ledger",
                    "ref_id": doc.gl_entry_id,
                }
            )
        logs = await self.session.execute(
            select(SalesSendLog).where(SalesSendLog.tenant_id == self.tenant_id, SalesSendLog.document_id == doc.id)
        )
        for log in logs.scalars():
            ok = log.status == "sent"
            events.append(
                {
                    "at": aware(log.sent_at),
                    "type": "sent" if ok else "send_failed",
                    "actor": log.sent_by,
                    "message": f"Sent to {log.to_addr}" if ok else f"Sending to {log.to_addr} failed: {log.detail}",
                    "ref_id": log.id,
                }
            )
        for pay in doc.payments:
            events.append(
                {
                    "at": aware(pay.created_at or pay.pay_date),
                    "type": "payment",
                    "actor": None,
                    "message": f"Payment {pay.amount} {doc.currency} ({pay.method})",
                    "ref_id": pay.id,
                }
            )
        for child in (await self.related(doc.id))["derived"]:
            events.append(
                {
                    "at": aware(child.created_at or child.doc_date),
                    "type": "credit_note" if child.kind == "credit_note" else "derived",
                    "actor": child.created_by,
                    "message": f"{child.kind.replace('_', ' ').capitalize()} {child.number} created",
                    "ref_id": child.id,
                }
            )
        events.sort(key=lambda e: e["at"], reverse=True)
        return events

    async def stats(self, today: date | None = None) -> dict[str, Any]:
        today = today or date.today()
        D = SalesDocument
        docs = (
            await self.session.execute(
                select(D).where(
                    D.tenant_id == self.tenant_id,
                    or_(
                        D.kind.in_(("quote", "invoice")), (D.kind == "order") & D.status.in_(("confirmed", "delivered"))
                    ),
                )
            )
        ).scalars()
        open_q = overdue_v = to_inv_v = invoiced = ZERO
        open_q_n = won = decided = overdue_n = to_inv_n = 0
        for d in list(docs):
            fx = d.fx_rate or Decimal(1)
            if d.kind == "quote":
                if d.status in {"draft", "sent", "accepted"}:
                    open_q_n += 1
                    open_q += d.gross_total * fx
                if d.status in {"accepted", "converted"}:
                    won += 1
                if d.status in {"accepted", "converted", "rejected", "expired"}:
                    decided += 1
            elif d.kind == "order":
                to_inv_n += 1
                rem = await self._annotate_remaining(d)
                for ln in d.lines:
                    if ln.qty > 0:
                        to_inv_v += ln.gross * max(ZERO, rem[ln.line_no]) / ln.qty * fx
            else:
                if d.status in {"issued", "partially_paid", "paid"} and d.doc_date.replace(day=1) == today.replace(
                    day=1
                ):
                    invoiced += d.net_total * fx
                if d.status in {"issued", "partially_paid"} and d.due_date and d.due_date < today and d.balance_due > 0:
                    overdue_n += 1
                    overdue_v += d.balance_due * fx
        return {
            "currency": base_currency(),
            "open_quotes_count": open_q_n,
            "open_quotes_value": money(open_q),
            "win_rate": (won / decided) if decided else None,
            "orders_to_invoice_count": to_inv_n,
            "orders_to_invoice_value": money(to_inv_v),
            "invoiced_this_month": money(invoiced),
            "overdue_count": overdue_n,
            "overdue_value": money(overdue_v),
        }

    # ── GL posting ────────────────────────────────────────────────────────
    async def invoice_to_credit_note(self, invoice_id: uuid.UUID, created_by: str | None = None) -> SalesDocument:
        inv = await self.get(invoice_id, "invoice")
        if inv.status not in {"issued", "partially_paid", "paid"}:
            raise SalesConflictError("Only an issued invoice can be credited")
        return await self._copy(inv, "credit_note", created_by)

    async def _gl(self, aw: Any) -> Any:
        try:
            return await aw
        except GLError as exc:
            raise SalesConflictError(f"GL: {exc}") from exc

    async def account_mapping(self) -> dict[str, str | None]:
        rows = (
            await self.session.execute(select(SalesAccountMap).where(SalesAccountMap.tenant_id == self.tenant_id))
        ).scalars()
        overrides = {m.role: m.account_code for m in rows}
        tpl = await self.session.scalar(
            select(GLAccount.template)
            .where(GLAccount.tenant_id == self.tenant_id, GLAccount.template.is_not(None))
            .limit(1)
        )
        defaults = DEFAULT_ACCOUNTS.get(tpl or "", {})
        return {r: overrides.get(r) or defaults.get(r) for r in ROLES}

    async def set_account_mapping(self, mapping: dict[str, str]) -> dict[str, str | None]:
        for role, code in mapping.items():
            if role not in ROLES:
                raise SalesValidationError(f"Unknown role {role}; expected one of {ROLES}")
            row = await self.session.scalar(
                select(SalesAccountMap).where(SalesAccountMap.tenant_id == self.tenant_id, SalesAccountMap.role == role)
            )
            if row is None:
                self.session.add(SalesAccountMap(tenant_id=self.tenant_id, role=role, account_code=code))
            else:
                row.account_code = code
        await self.session.flush()
        return await self.account_mapping()

    async def _accounts(self, *roles: str) -> dict[str, uuid.UUID]:
        mapping = await self.account_mapping()
        out: dict[str, uuid.UUID] = {}
        for role in roles:
            code = mapping.get(role)
            acc = (
                await self.session.scalar(
                    select(GLAccount).where(GLAccount.tenant_id == self.tenant_id, GLAccount.code == code)
                )
                if code
                else None
            )
            if acc is None:
                raise SalesConflictError(
                    f"GL account for role '{role}' is missing (code {code or 'unset'}); "
                    "load a chart of accounts or set PUT /api/v1/sales/settings/accounts/"
                )
            out[role] = acc.id
        return out

    async def issue_invoice(self, invoice_id: uuid.UUID, created_by: str | None = None) -> SalesDocument:
        inv = await self.get(invoice_id, "invoice")
        check_transition("invoice", inv.status, "issued")
        if inv.gross_total <= 0:
            raise SalesValidationError("Invoice total must be positive")
        if inv.currency != base_currency() and inv.fx_rate == 1:
            # Legacy drafts defaulted to 1; a foreign invoice must post at the document-date rate.
            inv.fx_rate = await self._rate(inv.currency, inv.doc_date, None)
        acc = await self._accounts("receivable", "revenue", "vat")
        lines = [
            LineInput(
                acc["receivable"], debit=inv.gross_total, description=f"{inv.number} {inv.customer_name}".strip()
            ),
            LineInput(acc["revenue"], credit=inv.net_total, description=inv.number),
        ]
        if inv.tax_total > 0:
            lines.append(LineInput(acc["vat"], credit=inv.tax_total, description=f"{inv.number} VAT"))
        entry = await self._gl(
            self.gl.create_entry(
                entry_date=inv.doc_date,
                lines=lines,
                currency=inv.currency,
                fx_rate=inv.fx_rate,
                memo=f"Sales invoice {inv.number}",
                source_type=SOURCE_INVOICE,
                source_id=str(inv.id),
                created_by=created_by,
                post=True,
            )
        )
        inv.gl_entry_id = entry.id
        await self._stock_for_invoice(inv, cancel=False, created_by=created_by)
        inv.status = "issued"
        await self.session.flush()
        return inv

    async def issue_credit_note(self, credit_id: uuid.UUID, created_by: str | None = None) -> SalesDocument:
        """DR revenue / DR output VAT / CR receivable for the credited lines; reduces the invoice's open amount."""
        cn = await self.get(credit_id, "credit_note")
        check_transition("credit_note", cn.status, "issued")
        if cn.gross_total <= 0:
            raise SalesValidationError("Credit note total must be positive")
        inv = await self.get(cn.source_id, "invoice") if cn.source_id else None
        if inv is not None:
            if inv.status not in {"issued", "partially_paid", "paid"}:
                raise SalesConflictError(f"Source invoice {inv.number} is {inv.status}")
            credited = ZERO
            for other in await self.list_documents("credit_note", status="issued"):
                if other.source_id == inv.id:
                    credited += other.gross_total
            if credited + cn.gross_total > inv.gross_total:
                raise SalesValidationError(
                    f"Credit exceeds invoice {inv.number}: {inv.gross_total - credited} left to credit"
                )
        acc = await self._accounts("receivable", "revenue", "vat")
        lines = [LineInput(acc["revenue"], debit=cn.net_total, description=cn.number)]
        if cn.tax_total > 0:
            lines.append(LineInput(acc["vat"], debit=cn.tax_total, description=f"{cn.number} VAT"))
        lines.append(
            LineInput(acc["receivable"], credit=cn.gross_total, description=f"{cn.number} {cn.customer_name}".strip())
        )
        entry = await self._gl(
            self.gl.create_entry(
                entry_date=cn.doc_date,
                lines=lines,
                currency=cn.currency,
                fx_rate=cn.fx_rate,
                memo=f"Sales credit note {cn.number}" + (f" for {inv.number}" if inv is not None else ""),
                source_type=SOURCE_CREDIT,
                source_id=str(cn.id),
                created_by=created_by,
                post=True,
            )
        )
        cn.gl_entry_id = entry.id
        cn.status = "issued"
        if inv is not None:
            # Settles the open item; any excess over the open amount stays as a customer credit on AR.
            inv.amount_paid = inv.amount_paid + min(cn.gross_total, inv.gross_total - inv.amount_paid)
            if inv.amount_paid >= inv.gross_total:
                inv.status = "paid"
            elif inv.amount_paid > 0:
                inv.status = "partially_paid"
        await self.session.flush()
        return cn

    async def record_payment(
        self,
        invoice_id: uuid.UUID,
        *,
        amount: Any,
        pay_date: date | None = None,
        method: str = "bank_transfer",
        reference: str = "",
        created_by: str | None = None,
        debit_account_id: uuid.UUID | None = None,
        fx_rate: Any = None,
        base_amount: Any = None,
    ) -> SalesDocument:
        """``debit_account_id`` overrides the bank role (a specific bank account or a write-off account).

        Foreign invoices: ``amount`` is in invoice currency; cash is valued at ``fx_rate`` (default: register
        rate on ``pay_date``) or the actual ``base_amount`` received, and the difference to the invoice rate
        is posted as realized FX gain/loss.
        """
        inv = await self.get(invoice_id, "invoice")
        if inv.status not in {"issued", "partially_paid"}:
            raise SalesConflictError(f"Payments need an issued invoice (is {inv.status})")
        amount = money(amount)
        outstanding = inv.gross_total - inv.amount_paid
        if amount <= 0 or amount > outstanding:
            raise SalesValidationError(f"Payment must be between 0.01 and the outstanding {outstanding}")
        acc = await self._accounts("bank", "receivable")
        pay = SalesPayment(
            tenant_id=self.tenant_id,
            pay_date=pay_date or date.today(),
            amount=amount,
            method=method,
            reference=reference,
        )
        inv.payments.append(pay)
        await self.session.flush()
        currency, rate = inv.currency, inv.fx_rate
        lines = [
            LineInput(debit_account_id or acc["bank"], debit=amount, description=f"Payment {inv.number}"),
            LineInput(acc["receivable"], credit=amount, description=f"Payment {inv.number}"),
        ]
        if inv.currency != base_currency():
            pay_rate = Decimal(1) if base_amount is not None else await self._rate(inv.currency, pay.pay_date, fx_rate)
            s = settlement(amount, inv.fx_rate, pay_rate, money(base_amount) if base_amount is not None else None)
            try:
                lines = await settlement_lines(
                    self.session,
                    self.tenant_id,
                    s=s,
                    cash_account=debit_account_id or acc["bank"],
                    open_account=acc["receivable"],
                    incoming=True,
                    label=f"Payment {inv.number}",
                )
            except FxRateMissingError as exc:
                raise SalesConflictError(str(exc)) from exc
            pay.fx_rate = pay_rate if base_amount is None else q_rate(s.base_cash / amount)
            currency, rate = base_currency(), None
            reference = reference or f"{amount} {inv.currency}"
        entry = await self._gl(
            self.gl.create_entry(
                entry_date=pay.pay_date,
                lines=lines,
                currency=currency,
                fx_rate=rate,
                memo=f"Payment {inv.number} {reference}".strip(),
                source_type=SOURCE_PAYMENT,
                source_id=str(pay.id),
                created_by=created_by,
                post=True,
            )
        )
        pay.gl_entry_id = entry.id
        inv.amount_paid = inv.amount_paid + amount
        inv.status = "paid" if inv.amount_paid >= inv.gross_total else "partially_paid"
        await self.session.flush()
        return inv

    # ── Dashboard summary ─────────────────────────────────────────────────
    async def summary(self, today: date | None = None, months_back: int = 6) -> dict[str, Any]:
        today = today or date.today()
        months_back = max(1, min(int(months_back), 24))
        D = SalesDocument
        rows = (
            await self.session.execute(
                select(
                    D.kind, D.status, D.doc_date, D.due_date, D.net_total, D.gross_total, D.amount_paid, D.fx_rate
                ).where(D.tenant_id == self.tenant_id)
            )
        ).all()
        receivables = open_quotes = open_orders = ZERO
        overdue = 0
        months: dict[str, Decimal] = {}
        first = today.replace(day=1)
        for i in range(months_back - 1, -1, -1):
            y, m = divmod(first.year * 12 + first.month - 1 - i, 12)
            months[f"{y:04d}-{m + 1:02d}"] = ZERO
        for kind, st, doc_date, due, net, gross, paid, fx in rows:
            fx = fx or Decimal(1)
            if kind == "invoice" and st in {"issued", "partially_paid"}:
                receivables += (gross - paid) * fx
                if due and due < today:
                    overdue += 1
            elif kind == "quote" and st in {"draft", "sent", "accepted"}:
                open_quotes += gross * fx
            elif kind == "order" and st in {"draft", "confirmed"}:
                open_orders += gross * fx
            if kind == "invoice" and st in {"issued", "partially_paid", "paid"}:
                key = doc_date.strftime("%Y-%m")
                if key in months:
                    months[key] += net * fx
            elif kind == "credit_note" and st == "issued":
                key = doc_date.strftime("%Y-%m")
                if key in months:
                    months[key] -= net * fx
        payables = None
        try:
            code = "1600" if await self._is_skr03() else "2200"
            tb = await self.gl.trial_balance(None, None)
            row = next((r for r in tb["rows"] if r["code"] == code), None)
            payables = -row["closing"] if row else ZERO
        except GLError:
            payables = None
        this_month = months[first.strftime("%Y-%m")]
        top_customers, top_items = await self._month_leaders(first)
        return {
            "currency": base_currency(),
            "receivables": money(receivables),
            "overdue_count": overdue,
            "open_quotes_value": money(open_quotes),
            "open_orders_value": money(open_orders),
            "payables": None if payables is None else money(payables),
            "revenue_this_month": money(this_month),
            "revenue_by_month": [{"month": k, "revenue": money(v)} for k, v in months.items()],
            "top_customers": top_customers,
            "top_items": top_items,
        }

    async def _month_leaders(self, first: date, limit: int = 5) -> tuple[list[dict], list[dict]]:
        """Customers and items ranked by net invoiced (base currency) since ``first``."""
        D, L = SalesDocument, SalesLine
        cond = (
            (D.tenant_id == self.tenant_id)
            & (D.kind == "invoice")
            & D.status.in_(("issued", "partially_paid", "paid"))
            & (D.doc_date >= first)
        )
        docs = (
            await self.session.execute(select(D.customer_id, D.customer_name, D.net_total, D.fx_rate).where(cond))
        ).all()
        cust: dict[str, dict] = {}
        for cid, name, net, fx in docs:
            key = str(cid) if cid else (name or "").strip().lower()
            row = cust.setdefault(
                key,
                {"customer_id": str(cid) if cid else None, "customer_name": name or "", "revenue": ZERO, "invoices": 0},
            )
            row["revenue"] += net * (fx or Decimal(1))
            row["invoices"] += 1
        lines = (
            await self.session.execute(
                select(L.item_id, L.sku, L.description, L.qty, L.net, D.fx_rate)
                .join(D, D.id == L.document_id)
                .where(cond & (L.tenant_id == self.tenant_id))
            )
        ).all()
        items: dict[str, dict] = {}
        for iid, sku, desc, qty, net, fx in lines:
            key = str(iid) if iid else (sku or desc or "").strip().lower()
            if not key:
                continue
            row = items.setdefault(
                key,
                {
                    "item_id": str(iid) if iid else None,
                    "sku": sku or "",
                    "name": desc or sku or "",
                    "qty": ZERO,
                    "revenue": ZERO,
                },
            )
            row["qty"] += qty or ZERO
            row["revenue"] += (net or ZERO) * (fx or Decimal(1))

        def ranked(rows: dict[str, dict]) -> list[dict]:
            out = sorted(rows.values(), key=lambda r: r["revenue"], reverse=True)[:limit]
            return [
                {**r, "revenue": money(r["revenue"]), **({"qty": str(r["qty"].normalize())} if "qty" in r else {})}
                for r in out
            ]

        return ranked(cust), ranked(items)

    async def _is_skr03(self) -> bool:
        tpl = await self.session.scalar(
            select(GLAccount.template)
            .where(GLAccount.tenant_id == self.tenant_id, GLAccount.template.is_not(None))
            .limit(1)
        )
        return tpl == "de_skr03"
