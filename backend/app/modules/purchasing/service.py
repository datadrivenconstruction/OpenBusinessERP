"""Purchasing service: PO totals, receipts with stock, bills with 3-way match, payments, GL posting."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.gl.models import DEFAULT_TENANT, GLAccount, GLJournalEntry
from app.modules.gl.service import GLError, GLService, LineInput, base_currency
from app.modules.purchasing.models import (
    PurchasingAccountMap,
    PurchasingBill,
    PurchasingBillLine,
    PurchasingOrder,
    PurchasingOrderLine,
    PurchasingPayment,
    PurchasingReceipt,
    PurchasingReceiptLine,
    PurchasingSequence,
    PurchasingStock,
)
from app.modules.sales.service import default_tax_rate, money

ZERO = Decimal(0)
HUNDRED = Decimal(100)
PRICE_TOLERANCE = Decimal("0.005")
PREFIX = {"order": "PO", "receipt": "GR", "bill": "BILL", "credit_note": "CN"}
SOURCE_RECEIPT = "purchasing_receipt"
SOURCE_BILL = "purchasing_bill"
SOURCE_CREDIT = "purchasing_credit_note"
SOURCE_PAYMENT = "purchasing_payment"
BILL_KINDS = ("bill", "credit_note")
OPEN_PO = {"confirmed", "partially_received", "received"}

PO_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"confirmed", "cancelled"},
    "confirmed": {"cancelled", "closed"},
    "partially_received": {"closed"},
    "received": {"closed"},
    "closed": set(),
    "cancelled": set(),
}
ROLES = ("inventory", "grni", "expense", "input_vat", "payables", "bank")
# Default account codes per loaded chart template; overridden by oe_purchasing_account_map.
DEFAULT_ACCOUNTS: dict[str, dict[str, str]] = {
    "de_skr03": {
        "inventory": "3980",
        "grni": "1720",
        "expense": "3400",
        "input_vat": "1576",
        "payables": "1600",
        "bank": "1200",
    },
    "ifrs_generic": {
        "inventory": "1300",
        "grni": "2550",
        "expense": "5000",
        "input_vat": "1450",
        "payables": "2200",
        "bank": "1710",
    },
}


# Charts seeded before the dedicated GRNI account existed keep posting to the old clearing account.
GRNI_FALLBACK: dict[str, str] = {"de_skr03": "1700", "ifrs_generic": "2500"}


class PurchasingError(Exception):
    pass


class PurchasingNotFoundError(PurchasingError):
    pass


class PurchasingValidationError(PurchasingError):
    pass


class PurchasingConflictError(PurchasingError):
    pass


@dataclass
class LineData:
    description: str = ""
    sku: str = ""
    qty: Decimal = Decimal(1)
    unit_price: Decimal = ZERO
    tax_rate: Decimal | None = None
    item_id: uuid.UUID | None = None
    order_line_id: uuid.UUID | None = None
    discount_pct: Decimal = ZERO


def line_amounts(qty: Any, unit_price: Any, tax_rate: Any, discount_pct: Any = 0) -> tuple[Decimal, Decimal, Decimal]:
    qty, unit_price, tax_rate = Decimal(str(qty)), Decimal(str(unit_price)), Decimal(str(tax_rate))
    discount_pct = Decimal(str(discount_pct))
    if not ZERO <= discount_pct <= HUNDRED:
        raise PurchasingValidationError("Discount must be between 0 and 100")
    if qty < 0 or unit_price < 0:
        raise PurchasingValidationError("Quantity and unit price must be non-negative")
    if not ZERO <= tax_rate <= HUNDRED:
        raise PurchasingValidationError("Tax rate must be between 0 and 100")
    net = money(qty * unit_price * (HUNDRED - discount_pct) / HUNDRED)
    tax = money(net * tax_rate / HUNDRED)
    return net, tax, net + tax


def _fill(row: Any, i: int, ln: LineData, fallback_rate: Decimal) -> Any:
    rate = fallback_rate if ln.tax_rate is None else Decimal(str(ln.tax_rate))
    row.net, row.tax, row.gross = line_amounts(ln.qty, ln.unit_price, rate, ln.discount_pct)
    row.line_no, row.sku, row.description = i, ln.sku or "", ln.description or ""
    row.qty, row.unit_price, row.tax_rate = Decimal(str(ln.qty)), Decimal(str(ln.unit_price)), rate
    row.item_id = ln.item_id
    row.discount_pct = Decimal(str(ln.discount_pct))
    return row


def _totals(doc: Any) -> None:
    doc.net_total = sum((ln.net for ln in doc.lines), ZERO)
    doc.tax_total = sum((ln.tax for ln in doc.lines), ZERO)
    doc.gross_total = doc.net_total + doc.tax_total


def _signed(account: uuid.UUID, amount: Decimal, desc: str) -> LineInput:
    """Debit a positive amount, credit a negative one."""
    if amount >= 0:
        return LineInput(account, debit=amount, description=desc)
    return LineInput(account, credit=-amount, description=desc)


class PurchasingService:
    def __init__(self, session: AsyncSession, tenant_id: str = DEFAULT_TENANT) -> None:
        self.session = session
        self.tenant_id = tenant_id
        self.gl = GLService(session, tenant_id)

    # ── Numbering ─────────────────────────────────────────────────────────
    async def _next_number(self, kind: str) -> str:
        seq = await self.session.scalar(
            select(PurchasingSequence)
            .where(PurchasingSequence.tenant_id == self.tenant_id, PurchasingSequence.kind == kind)
            .with_for_update()
        )
        if seq is None:
            seq = PurchasingSequence(tenant_id=self.tenant_id, kind=kind, last_number=0)
            self.session.add(seq)
        seq.last_number += 1
        await self.session.flush()
        return f"{PREFIX[kind]}-{seq.last_number:06d}"

    # ── Accounts / GL ─────────────────────────────────────────────────────
    async def _gl(self, aw: Any) -> Any:
        try:
            return await aw
        except GLError as exc:
            raise PurchasingConflictError(f"GL: {exc}") from exc

    async def account_mapping(self) -> dict[str, str | None]:
        rows = (
            await self.session.execute(
                select(PurchasingAccountMap).where(PurchasingAccountMap.tenant_id == self.tenant_id)
            )
        ).scalars()
        overrides = {m.role: m.account_code for m in rows}
        tpl = await self.session.scalar(
            select(GLAccount.template)
            .where(GLAccount.tenant_id == self.tenant_id, GLAccount.template.is_not(None))
            .limit(1)
        )
        defaults = dict(DEFAULT_ACCOUNTS.get(tpl or "", {}))
        if "grni" not in overrides and defaults.get("grni") and tpl in GRNI_FALLBACK:
            has_grni = await self.session.scalar(
                select(GLAccount.id).where(GLAccount.tenant_id == self.tenant_id, GLAccount.code == defaults["grni"])
            )
            if has_grni is None:
                defaults["grni"] = GRNI_FALLBACK[tpl]
        return {r: overrides.get(r) or defaults.get(r) for r in ROLES}

    async def set_account_mapping(self, mapping: dict[str, str]) -> dict[str, str | None]:
        for role, code in mapping.items():
            if role not in ROLES:
                raise PurchasingValidationError(f"Unknown role {role}; expected one of {ROLES}")
            row = await self.session.scalar(
                select(PurchasingAccountMap).where(
                    PurchasingAccountMap.tenant_id == self.tenant_id, PurchasingAccountMap.role == role
                )
            )
            if row is None:
                self.session.add(PurchasingAccountMap(tenant_id=self.tenant_id, role=role, account_code=code))
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
                raise PurchasingConflictError(
                    f"GL account for role '{role}' is missing (code {code or 'unset'}); "
                    "load a chart of accounts or set PUT /api/v1/purchasing/settings/accounts/"
                )
            out[role] = acc.id
        return out

    async def _post(self, doc: Any, lines: list[LineInput], memo: str, source: str, source_id: str, by: str | None):
        return await self._gl(
            self.gl.create_entry(
                entry_date=doc.doc_date,
                lines=lines,
                currency=doc.currency,
                fx_rate=doc.fx_rate,
                memo=memo,
                source_type=source,
                source_id=source_id,
                created_by=by,
                post=True,
            )
        )

    async def _items(self, ids: set[uuid.UUID]) -> dict[uuid.UUID, Any]:
        from app.modules.items.models import Item

        if not ids:
            return {}
        rows = (
            await self.session.execute(select(Item).where(Item.tenant_id == self.tenant_id, Item.id.in_(ids)))
        ).scalars()
        return {it.id: it for it in rows}

    # ── Purchase orders ───────────────────────────────────────────────────
    async def get_order(self, order_id: uuid.UUID) -> PurchasingOrder:
        po = await self.session.get(PurchasingOrder, order_id)
        if po is None or po.tenant_id != self.tenant_id:
            raise PurchasingNotFoundError("Purchase order not found")
        return po

    async def list_orders(self, status: str | None = None, limit: int = 500) -> list[PurchasingOrder]:
        q = select(PurchasingOrder).where(PurchasingOrder.tenant_id == self.tenant_id)
        if status:
            q = q.where(PurchasingOrder.status == status)
        return list((await self.session.execute(q.order_by(PurchasingOrder.number.desc()).limit(limit))).scalars())

    async def _order_lines(self, lines: list[LineData]) -> list[PurchasingOrderLine]:
        items = await self._items({ln.item_id for ln in lines if ln.item_id})
        fallback = default_tax_rate() if any(ln.tax_rate is None for ln in lines) else ZERO
        out = []
        for i, ln in enumerate(lines, start=1):
            if ln.item_id and ln.item_id not in items:
                raise PurchasingValidationError(f"Item {ln.item_id} not found")
            out.append(_fill(PurchasingOrderLine(tenant_id=self.tenant_id), i, ln, fallback))
        return out

    async def create_order(
        self, *, lines: list[LineData], doc_date: date | None = None, created_by: str | None = None, **data: Any
    ) -> PurchasingOrder:
        po = PurchasingOrder(
            tenant_id=self.tenant_id,
            number=await self._next_number("order"),
            status="draft",
            doc_date=doc_date or date.today(),
            due_date=data.get("due_date"),
            supplier_id=data.get("supplier_id"),
            supplier_name=data.get("supplier_name") or "",
            currency=(data.get("currency") or "EUR").upper(),
            fx_rate=Decimal(str(data.get("fx_rate") or 1)),
            notes=data.get("notes") or "",
            created_by=created_by,
        )
        po.lines = await self._order_lines(lines)
        _totals(po)
        self.session.add(po)
        await self.session.flush()
        return po

    async def update_order(self, order_id: uuid.UUID, **data: Any) -> PurchasingOrder:
        po = await self.get_order(order_id)
        if po.status != "draft":
            raise PurchasingConflictError(f"Only draft orders can be edited (is {po.status})")
        lines: list[LineData] | None = data.pop("lines", None)
        for k in ("supplier_id", "supplier_name", "currency", "fx_rate", "doc_date", "due_date", "notes"):
            if k in data and data[k] is not None:
                setattr(po, k, data[k].upper() if k == "currency" else data[k])
        if lines is not None:
            po.lines.clear()
            await self.session.flush()
            po.lines.extend(await self._order_lines(lines))
            _totals(po)
        await self.session.flush()
        return po

    async def delete_order(self, order_id: uuid.UUID) -> None:
        po = await self.get_order(order_id)
        if po.status != "draft":
            raise PurchasingConflictError("Only draft orders can be deleted")
        await self.session.delete(po)
        await self.session.flush()

    async def set_order_status(self, order_id: uuid.UUID, target: str) -> PurchasingOrder:
        po = await self.get_order(order_id)
        if target not in PO_TRANSITIONS.get(po.status, set()):
            raise PurchasingConflictError(f"order cannot go from {po.status} to {target}")
        if target == "confirmed" and po.gross_total <= 0:
            raise PurchasingValidationError("Order total must be positive")
        po.status = target
        await self.session.flush()
        return po

    # ── Goods receipts ────────────────────────────────────────────────────
    async def get_receipt(self, receipt_id: uuid.UUID) -> PurchasingReceipt:
        gr = await self.session.get(PurchasingReceipt, receipt_id)
        if gr is None or gr.tenant_id != self.tenant_id:
            raise PurchasingNotFoundError("Goods receipt not found")
        return gr

    async def list_receipts(self, order_id: uuid.UUID | None = None, limit: int = 500) -> list[PurchasingReceipt]:
        q = select(PurchasingReceipt).where(PurchasingReceipt.tenant_id == self.tenant_id)
        if order_id:
            q = q.where(PurchasingReceipt.order_id == order_id)
        return list((await self.session.execute(q.order_by(PurchasingReceipt.number.desc()).limit(limit))).scalars())

    async def receive(
        self,
        order_id: uuid.UUID,
        quantities: dict[uuid.UUID, Decimal] | None = None,
        *,
        doc_date: date | None = None,
        notes: str = "",
        created_by: str | None = None,
    ) -> PurchasingReceipt:
        """Post a (partial) receipt. ``quantities`` maps PO line id -> qty; None receives everything open.

        GL: DR inventory (stock-tracked items) or expense, CR GRNI - valued at PO net price.
        """
        po = await self.get_order(order_id)
        if po.status not in {"confirmed", "partially_received"}:
            raise PurchasingConflictError(f"Only confirmed orders can be received (is {po.status})")
        by_id = {ln.id: ln for ln in po.lines}
        if quantities is None:
            quantities = {ln.id: ln.qty - ln.qty_received for ln in po.lines}
        unknown = set(quantities) - set(by_id)
        if unknown:
            raise PurchasingValidationError("Receipt references lines outside this order")
        items = await self._items({ln.item_id for ln in po.lines if ln.item_id})
        gr = PurchasingReceipt(
            tenant_id=self.tenant_id,
            number=await self._next_number("receipt"),
            status="posted",
            order_id=po.id,
            order_number=po.number,
            supplier_name=po.supplier_name,
            currency=po.currency,
            fx_rate=po.fx_rate,
            doc_date=doc_date or date.today(),
            notes=notes,
            created_by=created_by,
        )
        gr.lines = []
        for pl in po.lines:
            qty = Decimal(str(quantities.get(pl.id, ZERO)))
            if qty == 0:
                continue
            if qty < 0 or qty > pl.qty - pl.qty_received:
                raise PurchasingValidationError(
                    f"Line {pl.line_no}: receive between 0 and the open {pl.qty - pl.qty_received}"
                )
            item = items.get(pl.item_id) if pl.item_id else None
            gr.lines.append(
                PurchasingReceiptLine(
                    tenant_id=self.tenant_id,
                    order_line_id=pl.id,
                    line_no=len(gr.lines) + 1,
                    item_id=pl.item_id,
                    sku=pl.sku,
                    description=pl.description,
                    qty=qty,
                    unit_cost=pl.net_unit_price,
                    value=money(qty * pl.net_unit_price),
                    stock_tracked=bool(item and item.stock_tracked),
                )
            )
        if not gr.lines:
            raise PurchasingValidationError("Nothing to receive")
        gr.value_total = sum((ln.value for ln in gr.lines), ZERO)
        self.session.add(gr)
        await self.session.flush()

        acc = await self._accounts("inventory", "expense", "grni")
        stock_val = sum((ln.value for ln in gr.lines if ln.stock_tracked), ZERO)
        other_val = gr.value_total - stock_val
        gl_lines = []
        if stock_val:
            gl_lines.append(LineInput(acc["inventory"], debit=stock_val, description=f"{gr.number} stock"))
        if other_val:
            gl_lines.append(LineInput(acc["expense"], debit=other_val, description=gr.number))
        gl_lines.append(LineInput(acc["grni"], credit=gr.value_total, description=f"{gr.number} GRNI"))
        if gr.value_total > 0:
            entry = await self._post(
                gr, gl_lines, f"Goods receipt {gr.number} ({po.number})", SOURCE_RECEIPT, str(gr.id), created_by
            )
            gr.gl_entry_id = entry.id

        for ln in gr.lines:
            by_id[ln.order_line_id].qty_received += ln.qty
            if ln.stock_tracked and ln.item_id:
                await self._add_stock(ln.item_id, ln.sku, ln.qty, ln.value)
        po.status = "received" if all(pl.qty_received >= pl.qty for pl in po.lines) else "partially_received"
        await self.session.flush()
        return gr

    async def _add_stock(self, item_id: uuid.UUID, sku: str, qty: Decimal, value: Decimal) -> None:
        row = await self.session.scalar(
            select(PurchasingStock).where(
                PurchasingStock.tenant_id == self.tenant_id, PurchasingStock.item_id == item_id
            )
        )
        if row is None:
            row = PurchasingStock(tenant_id=self.tenant_id, item_id=item_id, sku=sku, qty=ZERO, value=ZERO)
            self.session.add(row)
        row.qty += qty
        row.value += value

    async def stock(self) -> list[PurchasingStock]:
        q = select(PurchasingStock).where(PurchasingStock.tenant_id == self.tenant_id).order_by(PurchasingStock.sku)
        return list((await self.session.execute(q)).scalars())

    # ── Bills / credit notes ──────────────────────────────────────────────
    async def get_bill(self, bill_id: uuid.UUID, kind: str | None = None) -> PurchasingBill:
        bill = await self.session.get(PurchasingBill, bill_id)
        if bill is None or bill.tenant_id != self.tenant_id or (kind and bill.kind != kind):
            raise PurchasingNotFoundError("Supplier bill not found")
        return bill

    async def list_bills(self, kind: str = "bill", status: str | None = None, limit: int = 500) -> list[PurchasingBill]:
        q = select(PurchasingBill).where(PurchasingBill.tenant_id == self.tenant_id, PurchasingBill.kind == kind)
        if status:
            q = q.where(PurchasingBill.status == status)
        return list((await self.session.execute(q.order_by(PurchasingBill.number.desc()).limit(limit))).scalars())

    async def _bill_lines(self, bill: PurchasingBill, lines: list[LineData]) -> list[PurchasingBillLine]:
        po_lines: dict[uuid.UUID, PurchasingOrderLine] = {}
        if any(ln.order_line_id for ln in lines):
            if bill.order_id is None:
                raise PurchasingValidationError("Lines linked to an order need the bill's order_id")
            po_lines = {pl.id: pl for pl in (await self.get_order(bill.order_id)).lines}
        fallback = default_tax_rate() if any(ln.tax_rate is None for ln in lines) else ZERO
        out = []
        for i, ln in enumerate(lines, start=1):
            if ln.order_line_id and ln.order_line_id not in po_lines:
                raise PurchasingValidationError("Bill line references a line outside the order")
            row = _fill(PurchasingBillLine(tenant_id=self.tenant_id), i, ln, fallback)
            row.order_line_id = ln.order_line_id
            out.append(row)
        return out

    async def _match(self, bill: PurchasingBill) -> None:
        """3-way match: bill qty vs received-not-yet-billed qty, bill price vs PO price."""
        if bill.kind != "bill" or bill.order_id is None:
            bill.match_status = "none"
            for ln in bill.lines:
                ln.match_status = "none"
            return
        po_lines = {pl.id: pl for pl in (await self.get_order(bill.order_id)).lines}
        statuses = set()
        for ln in bill.lines:
            pl = po_lines.get(ln.order_line_id) if ln.order_line_id else None
            if pl is None:
                ln.match_status = "none"
            elif ln.qty > pl.qty_received - pl.qty_billed:
                ln.match_status = "qty_variance"
            elif abs(ln.unit_price * (HUNDRED - ln.discount_pct) / HUNDRED - pl.net_unit_price) > PRICE_TOLERANCE:
                ln.match_status = "price_variance"
            else:
                ln.match_status = "matched"
            statuses.add(ln.match_status)
        for s in ("qty_variance", "price_variance", "matched"):
            if s in statuses:
                bill.match_status = s
                return
        bill.match_status = "none"

    async def create_bill(
        self,
        kind: str = "bill",
        *,
        lines: list[LineData],
        doc_date: date | None = None,
        created_by: str | None = None,
        **data: Any,
    ) -> PurchasingBill:
        if kind not in BILL_KINDS:
            raise PurchasingValidationError(f"Unknown kind {kind}")
        bill_date = doc_date or date.today()
        bill = PurchasingBill(
            tenant_id=self.tenant_id,
            kind=kind,
            number=await self._next_number(kind),
            status="draft",
            doc_date=bill_date,
            due_date=data.get("due_date") or (bill_date + timedelta(days=30) if kind == "bill" else None),
            supplier_id=data.get("supplier_id"),
            supplier_name=data.get("supplier_name") or "",
            supplier_ref=data.get("supplier_ref") or "",
            order_id=data.get("order_id"),
            receipt_id=data.get("receipt_id"),
            source_id=data.get("source_id"),
            currency=(data.get("currency") or "EUR").upper(),
            fx_rate=Decimal(str(data.get("fx_rate") or 1)),
            notes=data.get("notes") or "",
            amount_paid=ZERO,
            created_by=created_by,
        )
        if bill.order_id:
            await self.get_order(bill.order_id)
        if bill.source_id:
            src = await self.get_bill(bill.source_id, "bill")
            bill.supplier_id, bill.supplier_name = (
                bill.supplier_id or src.supplier_id,
                bill.supplier_name or src.supplier_name,
            )
        bill.lines = await self._bill_lines(bill, lines)
        bill.payments = []
        _totals(bill)
        await self._match(bill)
        self.session.add(bill)
        await self.session.flush()
        return bill

    async def bill_from_order(self, order_id: uuid.UUID, created_by: str | None = None) -> PurchasingBill:
        """Draft bill for received-not-billed qty (or ordered-not-billed when nothing was received)."""
        po = await self.get_order(order_id)
        if po.status not in OPEN_PO:
            raise PurchasingConflictError(f"Order must be confirmed to bill (is {po.status})")
        received = any(pl.qty_received > 0 for pl in po.lines)
        lines = []
        for pl in po.lines:
            open_qty = (pl.qty_received if received else pl.qty) - pl.qty_billed
            if open_qty > 0:
                lines.append(
                    LineData(
                        pl.description, pl.sku, open_qty, pl.unit_price, pl.tax_rate, pl.item_id, pl.id, pl.discount_pct
                    )
                )
        if not lines:
            raise PurchasingConflictError("Nothing left to bill on this order")
        return await self.create_bill(
            "bill",
            lines=lines,
            created_by=created_by,
            order_id=po.id,
            supplier_id=po.supplier_id,
            supplier_name=po.supplier_name,
            currency=po.currency,
            fx_rate=po.fx_rate,
        )

    async def bill_from_receipt(self, receipt_id: uuid.UUID, created_by: str | None = None) -> PurchasingBill:
        gr = await self.get_receipt(receipt_id)
        po = await self.get_order(gr.order_id)
        po_lines = {pl.id: pl for pl in po.lines}
        lines = [
            LineData(
                ln.description,
                ln.sku,
                ln.qty,
                ln.unit_cost,
                po_lines[ln.order_line_id].tax_rate,
                ln.item_id,
                ln.order_line_id,
            )
            for ln in gr.lines
        ]
        return await self.create_bill(
            "bill",
            lines=lines,
            created_by=created_by,
            order_id=po.id,
            receipt_id=gr.id,
            supplier_id=po.supplier_id,
            supplier_name=po.supplier_name,
            currency=po.currency,
            fx_rate=po.fx_rate,
        )

    async def update_bill(self, bill_id: uuid.UUID, **data: Any) -> PurchasingBill:
        bill = await self.get_bill(bill_id)
        if bill.status != "draft":
            raise PurchasingConflictError(f"Only draft bills can be edited (is {bill.status})")
        lines: list[LineData] | None = data.pop("lines", None)
        for k in (
            "supplier_id",
            "supplier_name",
            "supplier_ref",
            "currency",
            "fx_rate",
            "doc_date",
            "due_date",
            "notes",
        ):
            if k in data and data[k] is not None:
                setattr(bill, k, data[k].upper() if k == "currency" else data[k])
        if lines is not None:
            bill.lines.clear()
            await self.session.flush()
            bill.lines.extend(await self._bill_lines(bill, lines))
            _totals(bill)
        await self._match(bill)
        await self.session.flush()
        return bill

    async def delete_bill(self, bill_id: uuid.UUID) -> None:
        bill = await self.get_bill(bill_id)
        if bill.status != "draft":
            raise PurchasingConflictError("Only draft bills can be deleted")
        await self.session.delete(bill)
        await self.session.flush()

    async def post_bill(self, bill_id: uuid.UUID, created_by: str | None = None) -> PurchasingBill:
        """Bill: DR GRNI (received qty at PO price) / expense (rest + price variance), DR input VAT, CR payables.

        Credit note: the mirror image against expense; applied to its source bill when given.
        """
        bill = await self.get_bill(bill_id)
        if bill.status != "draft":
            raise PurchasingConflictError(f"Only draft bills can be posted (is {bill.status})")
        if bill.gross_total <= 0:
            raise PurchasingValidationError("Bill total must be positive")
        await self._match(bill)
        acc = await self._accounts("grni", "expense", "input_vat", "payables")
        num = bill.number
        if bill.kind == "credit_note":
            lines = [
                LineInput(acc["payables"], debit=bill.gross_total, description=f"{num} {bill.supplier_name}".strip())
            ]
            lines.append(LineInput(acc["expense"], credit=bill.net_total, description=num))
            if bill.tax_total:
                lines.append(LineInput(acc["input_vat"], credit=bill.tax_total, description=f"{num} VAT"))
            entry = await self._post(
                bill, lines, f"Supplier credit note {num}", SOURCE_CREDIT, str(bill.id), created_by
            )
            bill.gl_entry_id = entry.id
            bill.status = "posted"
            if bill.source_id:
                src = await self.get_bill(bill.source_id, "bill")
                applied = min(bill.gross_total, src.gross_total - src.amount_paid)
                if applied > 0 and src.status in {"posted", "partially_paid"}:
                    src.amount_paid += applied
                    src.status = "paid" if src.amount_paid >= src.gross_total else "partially_paid"
                    bill.amount_paid = applied
                    bill.status = "applied" if applied >= bill.gross_total else "posted"
            await self.session.flush()
            return bill

        po_lines: dict[uuid.UUID, PurchasingOrderLine] = {}
        if bill.order_id:
            po_lines = {pl.id: pl for pl in (await self.get_order(bill.order_id)).lines}
        grni = ZERO
        for ln in bill.lines:
            pl = po_lines.get(ln.order_line_id) if ln.order_line_id else None
            if pl is None:
                continue
            cleared_qty = max(ZERO, min(ln.qty, pl.qty_received - pl.qty_billed))
            grni += money(cleared_qty * pl.net_unit_price)
            pl.qty_billed += ln.qty
        expense = bill.net_total - grni  # unreceived lines and price variance
        lines = []
        if grni:
            lines.append(LineInput(acc["grni"], debit=grni, description=f"{num} GRNI"))
        if expense:
            lines.append(_signed(acc["expense"], expense, num))
        if bill.tax_total:
            lines.append(LineInput(acc["input_vat"], debit=bill.tax_total, description=f"{num} VAT"))
        lines.append(
            LineInput(acc["payables"], credit=bill.gross_total, description=f"{num} {bill.supplier_name}".strip())
        )
        entry = await self._post(bill, lines, f"Supplier bill {num}", SOURCE_BILL, str(bill.id), created_by)
        bill.gl_entry_id = entry.id
        bill.status = "posted"
        await self.session.flush()
        return bill

    async def cancel_bill(self, bill_id: uuid.UUID, created_by: str | None = None) -> PurchasingBill:
        bill = await self.get_bill(bill_id)
        if bill.status == "draft":
            bill.status = "cancelled"
        elif bill.status == "posted" and not bill.payments and bill.amount_paid == 0:
            if bill.gl_entry_id:
                await self._gl(
                    self.gl.reverse_entry(bill.gl_entry_id, memo=f"Cancel {bill.number}", created_by=created_by)
                )
            if bill.order_id and bill.kind == "bill":
                po_lines = {pl.id: pl for pl in (await self.get_order(bill.order_id)).lines}
                for ln in bill.lines:
                    if ln.order_line_id in po_lines:
                        po_lines[ln.order_line_id].qty_billed -= ln.qty
            bill.status = "cancelled"
        else:
            raise PurchasingConflictError(f"Bill cannot be cancelled (is {bill.status})")
        await self.session.flush()
        return bill

    async def record_payment(
        self,
        bill_id: uuid.UUID,
        *,
        amount: Any,
        pay_date: date | None = None,
        method: str = "bank_transfer",
        reference: str = "",
        created_by: str | None = None,
    ) -> PurchasingBill:
        bill = await self.get_bill(bill_id, "bill")
        if bill.status not in {"posted", "partially_paid"}:
            raise PurchasingConflictError(f"Payments need a posted bill (is {bill.status})")
        amount = money(amount)
        outstanding = bill.gross_total - bill.amount_paid
        if amount <= 0 or amount > outstanding:
            raise PurchasingValidationError(f"Payment must be between 0.01 and the outstanding {outstanding}")
        acc = await self._accounts("payables", "bank")
        pay = PurchasingPayment(
            tenant_id=self.tenant_id,
            pay_date=pay_date or date.today(),
            amount=amount,
            method=method,
            reference=reference,
        )
        bill.payments.append(pay)
        await self.session.flush()
        entry = await self._gl(
            self.gl.create_entry(
                entry_date=pay.pay_date,
                lines=[
                    LineInput(acc["payables"], debit=amount, description=f"Payment {bill.number}"),
                    LineInput(acc["bank"], credit=amount, description=f"Payment {bill.number}"),
                ],
                currency=bill.currency,
                fx_rate=bill.fx_rate,
                memo=f"Payment {bill.number} {reference}".strip(),
                source_type=SOURCE_PAYMENT,
                source_id=str(pay.id),
                created_by=created_by,
                post=True,
            )
        )
        pay.gl_entry_id = entry.id
        bill.amount_paid += amount
        bill.status = "paid" if bill.amount_paid >= bill.gross_total else "partially_paid"
        await self.session.flush()
        return bill

    # ── List pages: filters, stats, duplicate, bulk, activity, related ────
    def _common_filters(self, stmt: Any, M: Any, statuses, supplier_id, q, date_from, date_to) -> Any:
        if statuses:
            stmt = stmt.where(M.status.in_(statuses))
        if supplier_id:
            stmt = stmt.where(M.supplier_id == supplier_id)
        if q and q.strip():
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(M.number.ilike(like), M.supplier_name.ilike(like)))
        if date_from:
            stmt = stmt.where(M.doc_date >= date_from)
        if date_to:
            stmt = stmt.where(M.doc_date <= date_to)
        return stmt

    async def _page(self, stmt: Any, M: Any, cols: dict[str, Any], sort: str, limit: int, offset: int):
        total = await self.session.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
        key = sort.lstrip("-")
        if key not in cols:
            raise PurchasingValidationError(f"Unknown sort '{sort}'; expected one of {sorted(cols)}")
        order = cols[key].desc().nulls_last() if sort.startswith("-") else cols[key].asc().nulls_last()
        stmt = stmt.order_by(order, M.number.desc()).limit(max(1, min(limit, 1000))).offset(max(0, offset))
        return list((await self.session.execute(stmt)).scalars()), int(total)

    async def query_orders(
        self,
        *,
        statuses: list[str] | None = None,
        supplier_id: uuid.UUID | None = None,
        q: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        overdue: bool | None = None,
        sort: str = "-doc_date",
        limit: int = 200,
        offset: int = 0,
        today: date | None = None,
    ) -> tuple[list[PurchasingOrder], int]:
        """``overdue`` on orders means late delivery: expected date passed while goods are still open."""
        M = PurchasingOrder
        stmt = self._common_filters(
            select(M).where(M.tenant_id == self.tenant_id), M, statuses, supplier_id, q, date_from, date_to
        )
        if overdue is not None:
            late = (
                M.due_date.is_not(None)
                & (M.due_date < (today or date.today()))
                & M.status.in_(("confirmed", "partially_received"))
            )
            stmt = stmt.where(late if overdue else ~late)
        cols = {
            "number": M.number,
            "doc_date": M.doc_date,
            "due_date": M.due_date,
            "gross_total": M.gross_total,
            "supplier_name": M.supplier_name,
        }
        return await self._page(stmt, M, cols, sort, limit, offset)

    async def query_bills(
        self,
        kind: str = "bill",
        *,
        statuses: list[str] | None = None,
        supplier_id: uuid.UUID | None = None,
        q: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        overdue: bool | None = None,
        match: list[str] | None = None,
        sort: str = "-doc_date",
        limit: int = 200,
        offset: int = 0,
        today: date | None = None,
    ) -> tuple[list[PurchasingBill], int]:
        M = PurchasingBill
        stmt = self._common_filters(
            select(M).where(M.tenant_id == self.tenant_id, M.kind == kind),
            M, statuses, supplier_id, q, date_from, date_to,
        )  # fmt: skip
        if match:
            stmt = stmt.where(M.match_status.in_(match))
        if overdue is not None:
            late = (
                (M.kind == "bill")
                & M.due_date.is_not(None)
                & (M.due_date < (today or date.today()))
                & (M.gross_total - M.amount_paid > 0)
                & M.status.not_in(("paid", "cancelled", "draft", "applied"))
            )
            stmt = stmt.where(late if overdue else ~late)
        cols = {
            "number": M.number,
            "doc_date": M.doc_date,
            "due_date": M.due_date,
            "gross_total": M.gross_total,
            "balance": M.gross_total - M.amount_paid,
            "supplier_name": M.supplier_name,
        }
        return await self._page(stmt, M, cols, sort, limit, offset)

    async def stats(self, today: date | None = None) -> dict[str, Any]:
        today = today or date.today()
        horizon = today + timedelta(days=7)
        open_po_n = recv_n = week_n = overdue_n = 0
        open_po = recv_v = week_v = overdue_v = ZERO
        orders = (
            await self.session.execute(
                select(PurchasingOrder).where(
                    PurchasingOrder.tenant_id == self.tenant_id, PurchasingOrder.status.in_(tuple(OPEN_PO))
                )
            )
        ).scalars()
        for po in orders:
            fx = po.fx_rate or Decimal(1)
            open_po_n += 1
            open_po += po.gross_total * fx
            if po.status in {"confirmed", "partially_received"}:
                recv_n += 1
                for ln in po.lines:
                    if ln.qty > 0:
                        recv_v += ln.gross * ln.remaining_qty / ln.qty * fx
        B = PurchasingBill
        bills = (
            await self.session.execute(
                select(B).where(
                    B.tenant_id == self.tenant_id, B.kind == "bill", B.status.in_(("posted", "partially_paid"))
                )
            )
        ).scalars()
        for b in bills:
            open_amt = b.balance_due * (b.fx_rate or Decimal(1))
            if b.balance_due <= 0 or b.due_date is None:
                continue
            if b.due_date < today:
                overdue_n += 1
                overdue_v += open_amt
            elif b.due_date <= horizon:
                week_n += 1
                week_v += open_amt
        return {
            "currency": base_currency(),
            "open_po_count": open_po_n,
            "open_po_value": money(open_po),
            "to_receive_count": recv_n,
            "to_receive_value": money(recv_v),
            "bills_due_week_count": week_n,
            "bills_due_week_value": money(week_v),
            "overdue_count": overdue_n,
            "overdue_value": money(overdue_v),
        }

    async def duplicate_order(self, order_id: uuid.UUID, created_by: str | None = None) -> PurchasingOrder:
        src = await self.get_order(order_id)
        today = date.today()
        return await self.create_order(
            lines=[
                LineData(ln.description, ln.sku, ln.qty, ln.unit_price, ln.tax_rate, ln.item_id, None, ln.discount_pct)
                for ln in src.lines
            ],
            doc_date=today,
            created_by=created_by,
            due_date=today + (src.due_date - src.doc_date) if src.due_date else None,
            supplier_id=src.supplier_id,
            supplier_name=src.supplier_name,
            currency=src.currency,
            fx_rate=src.fx_rate,
            notes=src.notes,
        )

    async def duplicate_bill(
        self, bill_id: uuid.UUID, kind: str | None = None, created_by: str | None = None
    ) -> PurchasingBill:
        """Fresh draft with the same header and lines; no order, receipt, source or payments are carried over."""
        src = await self.get_bill(bill_id, kind)
        today = date.today()
        return await self.create_bill(
            src.kind,
            lines=[
                LineData(ln.description, ln.sku, ln.qty, ln.unit_price, ln.tax_rate, ln.item_id, None, ln.discount_pct)
                for ln in src.lines
            ],
            doc_date=today,
            created_by=created_by,
            due_date=today + (src.due_date - src.doc_date) if src.due_date else None,
            supplier_id=src.supplier_id,
            supplier_name=src.supplier_name,
            currency=src.currency,
            fx_rate=src.fx_rate,
            notes=src.notes,
        )

    async def bulk(self, target: str, action: str, ids: list[uuid.UUID]) -> dict[str, Any]:
        """``target`` is 'order' or a bill kind. mark_sent confirms draft orders (a PO is 'sent' once confirmed)."""
        if action not in {"mark_sent", "delete_drafts", "reminder_drafts"}:
            raise PurchasingValidationError(f"Unknown action {action}")
        processed = 0
        skipped: list[dict[str, Any]] = []
        for doc_id in dict.fromkeys(ids):
            try:
                doc = await (self.get_order(doc_id) if target == "order" else self.get_bill(doc_id, target))
                if action == "mark_sent":
                    if target != "order":
                        raise PurchasingConflictError("Supplier bills are not sent")
                    await self.set_order_status(doc.id, "confirmed")
                elif action == "delete_drafts":
                    await (self.delete_order(doc.id) if target == "order" else self.delete_bill(doc.id))
                else:
                    raise PurchasingConflictError("Reminders are not applicable to purchasing documents")
                processed += 1
            except PurchasingNotFoundError:
                skipped.append({"id": doc_id, "reason": "not found"})
            except (PurchasingConflictError, PurchasingValidationError) as exc:
                skipped.append({"id": doc_id, "reason": str(exc)})
        await self.session.flush()
        return {"processed": processed, "skipped": skipped, "drafts": []}

    async def _gl_time(self, entry_id: uuid.UUID | None, fallback: Any) -> Any:
        entry = await self.session.get(GLJournalEntry, entry_id) if entry_id else None
        return entry.created_at if entry is not None and entry.created_at else fallback

    @staticmethod
    def _aware(v: Any) -> datetime:
        if isinstance(v, datetime):
            return v if v.tzinfo else v.replace(tzinfo=UTC)
        return datetime(v.year, v.month, v.day, tzinfo=UTC)

    async def order_activity(self, order_id: uuid.UUID) -> list[dict[str, Any]]:
        po = await self.get_order(order_id)
        ev = [self._event(po.created_at or po.doc_date, "created", po.created_by, f"Created {po.number}", po.id)]
        rel = await self.order_related(po.id)
        for gr in rel["derived"]["receipts"]:
            ev.append(
                self._event(
                    gr.created_at or gr.doc_date, "receipt", gr.created_by,
                    f"Goods receipt {gr.number} posted ({gr.value_total} {gr.currency})", gr.id,
                )
            )  # fmt: skip
        for b in rel["derived"]["bills"]:
            ev.append(self._event(b.created_at or b.doc_date, "bill", b.created_by, f"Bill {b.number} created", b.id))
        return sorted(ev, key=lambda e: e["at"], reverse=True)

    async def bill_activity(self, bill_id: uuid.UUID, kind: str | None = None) -> list[dict[str, Any]]:
        b = await self.get_bill(bill_id, kind)
        ev = [self._event(b.created_at or b.doc_date, "created", b.created_by, f"Created {b.number}", b.id)]
        if b.gl_entry_id:
            at = await self._gl_time(b.gl_entry_id, b.doc_date)
            ev.append(self._event(at, "posted", None, f"Posted {b.number} to the general ledger", b.gl_entry_id))
        for p in b.payments:
            ev.append(
                self._event(
                    p.created_at or p.pay_date, "payment", None, f"Payment {p.amount} {b.currency} ({p.method})", p.id
                )
            )
        for c in (await self.bill_related(b.id))["derived"]:
            ev.append(
                self._event(
                    c.created_at or c.doc_date, "credit_note", c.created_by, f"Credit note {c.number} created", c.id
                )
            )
        return sorted(ev, key=lambda e: e["at"], reverse=True)

    def _event(self, at: Any, type_: str, actor: str | None, message: str, ref_id: uuid.UUID | None) -> dict[str, Any]:
        return {"at": self._aware(at), "type": type_, "actor": actor, "message": message, "ref_id": ref_id}

    async def order_related(self, order_id: uuid.UUID) -> dict[str, Any]:
        po = await self.get_order(order_id)
        B = PurchasingBill
        bills = (
            await self.session.execute(
                select(B)
                .where(B.tenant_id == self.tenant_id, B.order_id == po.id, B.kind == "bill")
                .order_by(B.created_at)
            )
        ).scalars()
        receipts = await self.list_receipts(po.id)
        return {"source": None, "derived": {"receipts": list(reversed(receipts)), "bills": list(bills)}}

    async def bill_related(self, bill_id: uuid.UUID, kind: str | None = None) -> dict[str, Any]:
        b = await self.get_bill(bill_id, kind)
        order = receipt = src_bill = None
        if b.order_id:
            order = await self.session.get(PurchasingOrder, b.order_id)
        if b.receipt_id:
            receipt = await self.session.get(PurchasingReceipt, b.receipt_id)
        if b.source_id:
            src_bill = await self.session.get(PurchasingBill, b.source_id)
        order = order if order is not None and order.tenant_id == self.tenant_id else None
        receipt = receipt if receipt is not None and receipt.tenant_id == self.tenant_id else None
        src_bill = src_bill if src_bill is not None and src_bill.tenant_id == self.tenant_id else None
        M = PurchasingBill
        derived = (
            await self.session.execute(
                select(M).where(M.tenant_id == self.tenant_id, M.source_id == b.id).order_by(M.created_at)
            )
        ).scalars()
        source = {"order": order, "receipt": receipt, "bill": src_bill} if (order or receipt or src_bill) else None
        return {"source": source, "derived": list(derived)}

    # ── Dashboard summary ─────────────────────────────────────────────────
    async def summary(self, today: date | None = None) -> dict[str, Any]:
        today = today or date.today()
        open_po = payables = due_soon = overdue_value = ZERO
        overdue = 0
        for po in await self.list_orders(limit=10000):
            if po.status in OPEN_PO:
                open_po += po.gross_total * (po.fx_rate or 1)
        B = PurchasingBill
        rows = (
            await self.session.execute(
                select(B.kind, B.status, B.due_date, B.gross_total, B.amount_paid, B.fx_rate).where(
                    B.tenant_id == self.tenant_id, B.status.in_(("posted", "partially_paid"))
                )
            )
        ).all()
        horizon = today + timedelta(days=7)
        for kind, _st, due, gross, paid, fx in rows:
            open_amt = (gross - paid) * (fx or 1)
            if kind == "credit_note":
                payables -= open_amt
                continue
            payables += open_amt
            if due and due < today:
                overdue += 1
                overdue_value += open_amt
            elif due is None or due <= horizon:
                due_soon += open_amt
        return {
            "currency": base_currency(),
            "open_po_value": money(open_po),
            "bills_due": money(due_soon),
            "overdue_count": overdue,
            "overdue_value": money(overdue_value),
            "payables": money(payables),
        }
