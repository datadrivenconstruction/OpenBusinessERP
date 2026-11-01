"""Inventory service: movement ledger, moving-average valuation, transfers, stocktakes, GL.

Valuation is moving average per item across all warehouses (one cost pool per item):
inbound movements blend their cost into the average, outbound movements leave at the
current average. Values are in base currency. GL postings:
    delivery    DR COGS / CR inventory at average cost (the sales invoice posts revenue only).
    stocktake   DR/CR inventory vs inventory-difference account.
    receipt     posted by purchasing (DR inventory / CR GRNI) - not re-posted here.
    opening / transfer - quantity only, no GL entry.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.exc import IntegrityError

from app.modules.gl.models import GLAccount
from app.modules.gl.service import GLError, GLService, LineInput
from app.modules.inventory.models import (
    MOVE_KINDS,
    InventorySettings,
    ItemCost,
    StockMovement,
    Stocktake,
    StocktakeLine,
    Warehouse,
)
from app.modules.items.models import Item

ZERO = Decimal(0)
CENT = Decimal("0.01")
COST_Q = Decimal("0.000001")
SOURCE_RECEIPT = "purchasing_receipt"
SOURCE_DELIVERY = "sales_delivery"
SOURCE_INVOICE_ISSUE = "sales_invoice_issue"  # invoice issued straight from an undelivered order
SOURCE_STOCKTAKE = "inventory_stocktake"
SOURCE_ADJUST = "inventory_adjustment"
SOURCE_TRANSFER = "inventory_transfer"
SOURCE_OPENING = "inventory_opening"
GL_DELIVERY = "inventory_cogs"
GL_ADJUST = "inventory_adjustment"
# Chart defaults; inventory itself follows the purchasing "inventory" role so receipts and issues hit one account.
DEFAULT_ACCOUNTS: dict[str, dict[str, str]] = {
    "de_skr03": {"cogs": "3400", "diff": "4900"},
    "ifrs_generic": {"cogs": "5000", "diff": "5500"},
}


class InventoryError(Exception):
    pass


class InventoryNotFoundError(InventoryError):
    pass


class InventoryValidationError(InventoryError):
    pass


class InventoryConflictError(InventoryError):
    pass


def money(v: Any) -> Decimal:
    return Decimal(v).quantize(CENT, rounding=ROUND_HALF_UP)


@dataclass(frozen=True)
class CostState:
    qty: Decimal = ZERO
    value: Decimal = ZERO
    avg: Decimal = ZERO


def apply_cost(state: CostState, qty: Decimal, unit_cost: Decimal | None = None) -> tuple[CostState, Decimal]:
    """Moving-average step. Inbound (qty > 0) needs ``unit_cost``; outbound leaves at the average.

    Returns the new state and the signed value of the movement. Issuing the last unit takes
    the remaining pool value so rounding residue never lingers at zero quantity.
    """
    qty = Decimal(qty)
    new_qty = state.qty + qty
    if qty > 0:
        if unit_cost is None:
            raise InventoryValidationError("Inbound movement needs a unit cost")
        dv = money(qty * Decimal(unit_cost))
        new_val = state.value + dv
        avg = (new_val / new_qty).quantize(COST_Q) if new_qty > 0 else Decimal(unit_cost).quantize(COST_Q)
        return CostState(new_qty, new_val, avg), dv
    if qty == 0:
        return state, ZERO
    dv = -state.value if new_qty == 0 else -money(-qty * state.avg)
    return CostState(new_qty, state.value + dv, state.avg), dv


def reverse_cost(state: CostState, qty: Decimal, value: Decimal) -> CostState:
    """Undo a movement exactly (negated qty and value); the average is re-derived."""
    new_qty, new_val = state.qty - qty, state.value - value
    if new_qty == 0:
        return CostState(ZERO, ZERO, state.avg)
    avg = (new_val / new_qty).quantize(COST_Q) if new_qty > 0 else state.avg
    return CostState(new_qty, new_val, avg)


class InventoryService:
    def __init__(self, session: AsyncSession, tenant_id: str) -> None:
        self.session = session
        self.tenant_id = tenant_id
        self.gl = GLService(session, tenant_id)

    # ── Settings ──────────────────────────────────────────────────────────
    async def settings(self) -> InventorySettings:
        row = await self.session.scalar(select(InventorySettings).where(InventorySettings.tenant_id == self.tenant_id))
        if row is None:
            row = InventorySettings(tenant_id=self.tenant_id, allow_negative=False)
            self.session.add(row)
            await self.session.flush()
        return row

    async def update_settings(self, **data: Any) -> InventorySettings:
        row = await self.settings()
        for k, v in data.items():
            if v is not None:
                setattr(row, k, v.strip() if isinstance(v, str) else v)
        await self.session.flush()
        return row

    async def account_codes(self) -> dict[str, str | None]:
        from app.modules.purchasing.service import PurchasingService

        st = await self.settings()
        tpl = await self.session.scalar(
            select(GLAccount.template)
            .where(GLAccount.tenant_id == self.tenant_id, GLAccount.template.is_not(None))
            .limit(1)
        )
        defaults = DEFAULT_ACCOUNTS.get(tpl or "", {})
        inv = st.inventory_account or (await PurchasingService(self.session, self.tenant_id).account_mapping()).get(
            "inventory"
        )
        return {
            "inventory": inv or None,
            "cogs": st.cogs_account or defaults.get("cogs"),
            "diff": st.diff_account or defaults.get("diff"),
        }

    async def _accounts(self, *roles: str) -> dict[str, uuid.UUID] | None:
        """Account ids for the roles, or None when the tenant has no chart loaded for them."""
        codes = await self.account_codes()
        out: dict[str, uuid.UUID] = {}
        for role in roles:
            code = codes.get(role)
            acc_id = (
                await self.session.scalar(
                    select(GLAccount.id).where(GLAccount.tenant_id == self.tenant_id, GLAccount.code == code)
                )
                if code
                else None
            )
            if acc_id is None:
                return None
            out[role] = acc_id
        return out

    async def _post_gl(self, day: date, lines: list[LineInput], memo: str, source: str, source_id: str, by: str | None):
        try:
            return await self.gl.create_entry(
                entry_date=day,
                lines=lines,
                memo=memo,
                source_type=source,
                source_id=source_id,
                created_by=by,
                post=True,
            )
        except GLError as exc:
            raise InventoryConflictError(f"GL: {exc}") from exc

    async def _reverse_gl(self, entry_id: uuid.UUID, memo: str, by: str | None) -> None:
        try:
            await self.gl.reverse_entry(entry_id, memo=memo, created_by=by)
        except GLError as exc:
            raise InventoryConflictError(f"GL: {exc}") from exc

    # ── Warehouses ────────────────────────────────────────────────────────
    async def list_warehouses(self, include_inactive: bool = True) -> list[Warehouse]:
        await self.default_warehouse()
        q = select(Warehouse).where(Warehouse.tenant_id == self.tenant_id)
        if not include_inactive:
            q = q.where(Warehouse.active.is_(True))
        return list((await self.session.execute(q.order_by(Warehouse.is_default.desc(), Warehouse.code))).scalars())

    async def default_warehouse(self) -> Warehouse:
        wh = await self.session.scalar(
            select(Warehouse).where(Warehouse.tenant_id == self.tenant_id, Warehouse.is_default.is_(True)).limit(1)
        )
        if wh is None:
            wh = await self.session.scalar(
                select(Warehouse).where(Warehouse.tenant_id == self.tenant_id).order_by(Warehouse.created_at).limit(1)
            )
            if wh is None:
                # Parallel first requests race to create MAIN; the loser re-reads the winner's row.
                try:
                    async with self.session.begin_nested():
                        wh = Warehouse(tenant_id=self.tenant_id, code="MAIN", name="Main warehouse", address="", active=True, is_default=True)
                        self.session.add(wh)
                except IntegrityError:
                    wh = await self.session.scalar(
                        select(Warehouse).where(Warehouse.tenant_id == self.tenant_id, Warehouse.code == "MAIN").limit(1)
                    )
                    if wh is None:
                        raise
            wh.is_default = True
            await self.session.flush()
        return wh

    async def get_warehouse(self, wh_id: uuid.UUID) -> Warehouse:
        wh = await self.session.get(Warehouse, wh_id)
        if wh is None or wh.tenant_id != self.tenant_id:
            raise InventoryNotFoundError("Warehouse not found")
        return wh

    async def _code_taken(self, code: str, exclude: uuid.UUID | None = None) -> bool:
        q = select(Warehouse.id).where(Warehouse.tenant_id == self.tenant_id, func.upper(Warehouse.code) == code)
        if exclude:
            q = q.where(Warehouse.id != exclude)
        return (await self.session.scalar(q)) is not None

    async def create_warehouse(self, code: str, name: str, address: str = "", is_default: bool = False) -> Warehouse:
        await self.default_warehouse()
        code = code.strip().upper()
        if not code or not name.strip():
            raise InventoryValidationError("Code and name are required")
        if await self._code_taken(code):
            raise InventoryConflictError(f"Warehouse code {code} already exists")
        wh = Warehouse(tenant_id=self.tenant_id, code=code, name=name.strip(), address=address, active=True)
        self.session.add(wh)
        await self.session.flush()
        if is_default:
            await self._make_default(wh)
        return wh

    async def _make_default(self, wh: Warehouse) -> None:
        for other in await self.list_warehouses():
            other.is_default = other.id == wh.id
        wh.active = True
        await self.session.flush()

    async def update_warehouse(self, wh_id: uuid.UUID, **data: Any) -> Warehouse:
        wh = await self.get_warehouse(wh_id)
        if data.get("code") is not None:
            code = data["code"].strip().upper()
            if not code or await self._code_taken(code, wh.id):
                raise InventoryConflictError(f"Warehouse code {code} is empty or taken")
            wh.code = code
        for k in ("name", "address"):
            if data.get(k) is not None:
                setattr(wh, k, data[k].strip())
        if data.get("active") is False:
            if wh.is_default:
                raise InventoryConflictError("The default warehouse cannot be deactivated")
            if any(q != 0 for (_, w), q in (await self.on_hand_map(warehouse_id=wh.id)).items() if w == wh.id):
                raise InventoryConflictError("Warehouse still holds stock; transfer it first")
            wh.active = False
        elif data.get("active") is True:
            wh.active = True
        if data.get("is_default") is True:
            await self._make_default(wh)
        await self.session.flush()
        return wh

    async def _wh(self, wh_id: uuid.UUID | None) -> Warehouse:
        wh = await self.get_warehouse(wh_id) if wh_id else await self.default_warehouse()
        if not wh.active:
            raise InventoryConflictError(f"Warehouse {wh.code} is inactive")
        return wh

    # ── Quantities ────────────────────────────────────────────────────────
    async def on_hand_map(
        self, item_ids: list[uuid.UUID] | None = None, warehouse_id: uuid.UUID | None = None
    ) -> dict[tuple[uuid.UUID, uuid.UUID], Decimal]:
        q = select(StockMovement.item_id, StockMovement.warehouse_id, func.sum(StockMovement.qty)).where(
            StockMovement.tenant_id == self.tenant_id
        )
        if item_ids is not None:
            if not item_ids:
                return {}
            q = q.where(StockMovement.item_id.in_(item_ids))
        if warehouse_id:
            q = q.where(StockMovement.warehouse_id == warehouse_id)
        rows = await self.session.execute(q.group_by(StockMovement.item_id, StockMovement.warehouse_id))
        return {(i, w): Decimal(s or 0) for i, w, s in rows}

    async def on_hand(self, item_ids: list[uuid.UUID]) -> dict[str, Decimal]:
        out: dict[str, Decimal] = {}
        for (i, _w), q in (await self.on_hand_map(item_ids)).items():
            out[str(i)] = out.get(str(i), ZERO) + q
        return out

    async def reserved(self, item_ids: list[uuid.UUID] | None = None) -> dict[str, Decimal]:
        """Quantity on confirmed (not yet delivered) sales orders per item."""
        from app.modules.sales.models import SalesDocument, SalesLine

        q = (
            select(SalesLine.item_id, func.sum(SalesLine.qty))
            .join(SalesDocument, SalesDocument.id == SalesLine.document_id)
            .where(
                SalesDocument.tenant_id == self.tenant_id,
                SalesDocument.kind == "order",
                SalesDocument.status == "confirmed",
                SalesLine.item_id.is_not(None),
            )
        )
        if item_ids is not None:
            if not item_ids:
                return {}
            q = q.where(SalesLine.item_id.in_(item_ids))
        rows = await self.session.execute(q.group_by(SalesLine.item_id))
        return {str(i): Decimal(s or 0) for i, s in rows}

    # ── Core movement ─────────────────────────────────────────────────────
    async def _item(self, item_id: uuid.UUID) -> Item:
        item = await self.session.get(Item, item_id)
        if item is None or item.tenant_id != self.tenant_id:
            raise InventoryNotFoundError("Item not found")
        if not item.stock_tracked:
            raise InventoryValidationError(f"Item {item.sku} is not stock-tracked")
        return item

    async def _cost_row(self, item_id: uuid.UUID) -> ItemCost:
        row = await self.session.scalar(
            select(ItemCost).where(ItemCost.tenant_id == self.tenant_id, ItemCost.item_id == item_id).with_for_update()
        )
        if row is None:
            row = ItemCost(tenant_id=self.tenant_id, item_id=item_id, qty=ZERO, value=ZERO, avg_cost=ZERO)
            self.session.add(row)
            await self.session.flush()
        return row

    async def _check_available(self, item: Item, wh: Warehouse, qty: Decimal, allow_negative: bool | None) -> None:
        if qty >= 0:
            return
        if allow_negative is None:
            allow_negative = (await self.settings()).allow_negative
        if allow_negative:
            return
        have = (await self.on_hand_map([item.id], wh.id)).get((item.id, wh.id), ZERO)
        if have + qty < 0:
            raise InventoryConflictError(
                f"Not enough stock of {item.sku} in {wh.code}: {have.normalize():f} on hand, {(-qty).normalize():f} needed"
            )

    async def move(
        self,
        item_id: uuid.UUID,
        qty: Decimal,
        kind: str,
        *,
        warehouse_id: uuid.UUID | None = None,
        unit_cost: Decimal | None = None,
        move_date: date | None = None,
        source_type: str = "",
        source_id: str = "",
        source_number: str = "",
        notes: str = "",
        created_by: str | None = None,
        transfer_group: uuid.UUID | None = None,
        allow_negative: bool | None = None,
    ) -> StockMovement:
        """Record one movement and update the item's cost pool. Positive qty is inbound."""
        if kind not in MOVE_KINDS:
            raise InventoryValidationError(f"Unknown movement kind {kind}")
        qty = Decimal(str(qty))
        if qty == 0:
            raise InventoryValidationError("Quantity must not be zero")
        item = await self._item(item_id)
        wh = await self._wh(warehouse_id)
        await self._check_available(item, wh, qty, allow_negative)
        row = await self._cost_row(item.id)
        state = CostState(Decimal(row.qty), Decimal(row.value), Decimal(row.avg_cost))
        if qty > 0 and unit_cost is None:
            unit_cost = state.avg if state.avg > 0 else Decimal(item.purchase_cost or 0)
        new, dv = apply_cost(state, qty, unit_cost)
        row.qty, row.value, row.avg_cost = new.qty, new.value, new.avg
        mv = StockMovement(
            tenant_id=self.tenant_id,
            item_id=item.id,
            warehouse_id=wh.id,
            kind=kind,
            move_date=move_date or date.today(),
            qty=qty,
            unit_cost=(abs(dv) / abs(qty)).quantize(COST_Q),
            value=dv,
            source_type=source_type,
            source_id=source_id,
            source_number=source_number,
            transfer_group=transfer_group,
            notes=notes,
            created_by=created_by,
        )
        self.session.add(mv)
        await self.session.flush()
        return mv

    async def _source_moves(self, source_type: str, source_id: str) -> list[StockMovement]:
        q = select(StockMovement).where(
            StockMovement.tenant_id == self.tenant_id,
            StockMovement.source_type == source_type,
            StockMovement.source_id == source_id,
            StockMovement.reversal_of_id.is_(None),
            StockMovement.reversed.is_(False),
        )
        return list((await self.session.execute(q.order_by(StockMovement.created_at))).scalars())

    async def reverse_source(
        self, source_type: str, source_id: str, *, created_by: str | None = None, on: date | None = None
    ) -> list[StockMovement]:
        """Reverse every open movement of a source document (exact qty and value)."""
        out = []
        settings = await self.settings()
        for mv in await self._source_moves(source_type, source_id):
            item = await self.session.get(Item, mv.item_id)
            wh = await self.session.get(Warehouse, mv.warehouse_id)
            if item is not None and wh is not None and not settings.allow_negative:
                await self._check_available(item, wh, -Decimal(mv.qty), False)
            row = await self._cost_row(mv.item_id)
            new = reverse_cost(
                CostState(Decimal(row.qty), Decimal(row.value), Decimal(row.avg_cost)), Decimal(mv.qty), mv.value
            )
            row.qty, row.value, row.avg_cost = new.qty, new.value, new.avg
            rev = StockMovement(
                tenant_id=self.tenant_id,
                item_id=mv.item_id,
                warehouse_id=mv.warehouse_id,
                kind=mv.kind,
                move_date=on or date.today(),
                qty=-mv.qty,
                unit_cost=mv.unit_cost,
                value=-mv.value,
                source_type=mv.source_type,
                source_id=mv.source_id,
                source_number=mv.source_number,
                reversal_of_id=mv.id,
                transfer_group=mv.transfer_group,
                notes=f"Reversal of {mv.source_number or mv.kind}",
                created_by=created_by,
            )
            mv.reversed = True
            self.session.add(rev)
            out.append(rev)
        await self.session.flush()
        return out

    # ── Purchasing / sales hooks ──────────────────────────────────────────
    async def receive_purchase(self, receipt: Any, warehouse_id: uuid.UUID | None = None) -> list[StockMovement]:
        """Receipt movements for stock-tracked lines; value converted to base at the receipt rate."""
        out = []
        fx = Decimal(receipt.fx_rate or 1)
        for ln in receipt.lines:
            if not (ln.stock_tracked and ln.item_id) or ln.qty <= 0:
                continue
            base_value = money(Decimal(ln.value) * fx)
            out.append(
                await self.move(
                    ln.item_id,
                    ln.qty,
                    "receipt",
                    warehouse_id=warehouse_id,
                    unit_cost=base_value / Decimal(ln.qty),
                    move_date=receipt.doc_date,
                    source_type=SOURCE_RECEIPT,
                    source_id=str(receipt.id),
                    source_number=receipt.number,
                    notes=receipt.supplier_name or "",
                    created_by=receipt.created_by,
                )
            )
        return out

    async def deliver_sales_order(
        self,
        order: Any,
        *,
        created_by: str | None = None,
        warehouse_id: uuid.UUID | None = None,
        on: date | None = None,
        post_gl: bool = True,
        source_type: str = SOURCE_DELIVERY,
        already: dict[uuid.UUID, Decimal] | None = None,
    ) -> list[StockMovement]:
        """Outbound movements for the document's stock-tracked lines plus one COGS entry at average cost.

        Runs once per (source_type, document); ``already`` maps item -> qty issued earlier by other sources.
        """
        ids = {ln.item_id for ln in order.lines if ln.item_id}
        if not ids or await self._source_moves(source_type, str(order.id)):
            return []
        skip = dict(already or {})
        tracked = set(
            (
                await self.session.execute(
                    select(Item.id).where(Item.tenant_id == self.tenant_id, Item.id.in_(ids), Item.stock_tracked)
                )
            ).scalars()
        )
        day = on or date.today()
        moves = []
        for ln in order.lines:
            qty = Decimal(ln.qty)
            done = min(qty, skip.get(ln.item_id, ZERO))
            if done > 0:
                skip[ln.item_id] -= done
                qty -= done
            if ln.item_id in tracked and qty > 0:
                moves.append(
                    await self.move(
                        ln.item_id,
                        -qty,
                        "delivery",
                        warehouse_id=warehouse_id,
                        move_date=day,
                        source_type=source_type,
                        source_id=str(order.id),
                        source_number=order.number,
                        notes=order.customer_name or "",
                        created_by=created_by,
                    )
                )
        cost = -sum((m.value for m in moves), ZERO)
        if post_gl and cost > 0:
            acc = await self._accounts("cogs", "inventory")
            if acc is not None:
                entry = await self._post_gl(
                    day,
                    [
                        LineInput(acc["cogs"], debit=cost, description=f"Cost of goods sold {order.number}"),
                        LineInput(acc["inventory"], credit=cost, description=f"Stock issue {order.number}"),
                    ],
                    f"Delivery {order.number}",
                    GL_DELIVERY,
                    str(order.id),
                    created_by,
                )
                for m in moves:
                    m.gl_entry_id = entry.id
        await self.session.flush()
        return moves

    async def cancel_source(self, source_type: str, source_id: str, created_by: str | None = None) -> int:
        """Reverse a source's movements and any GL entry this module posted for them."""
        entries = {m.gl_entry_id for m in await self._source_moves(source_type, source_id) if m.gl_entry_id}
        revs = await self.reverse_source(source_type, source_id, created_by=created_by)
        for e in entries:
            await self._reverse_gl(
                e, f"Reverse stock posting {revs[0].source_number if revs else ''}".strip(), created_by
            )
        return len(revs)

    # ── Manual operations ─────────────────────────────────────────────────
    async def transfer(
        self,
        item_id: uuid.UUID,
        from_wh: uuid.UUID,
        to_wh: uuid.UUID,
        qty: Decimal,
        *,
        move_date: date | None = None,
        notes: str = "",
        created_by: str | None = None,
    ) -> tuple[StockMovement, StockMovement]:
        if from_wh == to_wh:
            raise InventoryValidationError("Source and target warehouse must differ")
        qty = Decimal(str(qty))
        if qty <= 0:
            raise InventoryValidationError("Transfer quantity must be positive")
        await self._wh(to_wh)
        group = uuid.uuid4()
        common = {"move_date": move_date, "notes": notes, "created_by": created_by, "transfer_group": group}
        out = await self.move(
            item_id,
            -qty,
            "transfer_out",
            warehouse_id=from_wh,
            source_type=SOURCE_TRANSFER,
            source_id=str(group),
            **common,
        )
        inn = await self.move(
            item_id,
            qty,
            "transfer_in",
            warehouse_id=to_wh,
            unit_cost=-out.value / qty,
            source_type=SOURCE_TRANSFER,
            source_id=str(group),
            **common,
        )
        return out, inn

    async def opening(
        self,
        item_id: uuid.UUID,
        qty: Decimal,
        unit_cost: Decimal,
        *,
        warehouse_id: uuid.UUID | None = None,
        move_date: date | None = None,
        notes: str = "",
        created_by: str | None = None,
    ) -> StockMovement:
        if Decimal(str(qty)) <= 0 or Decimal(str(unit_cost)) < 0:
            raise InventoryValidationError("Opening stock needs a positive quantity and a non-negative cost")
        return await self.move(
            item_id,
            qty,
            "opening",
            warehouse_id=warehouse_id,
            unit_cost=Decimal(str(unit_cost)),
            move_date=move_date,
            source_type=SOURCE_OPENING,
            notes=notes or "Opening balance",
            created_by=created_by,
        )

    async def adjust(
        self,
        item_id: uuid.UUID,
        qty: Decimal,
        *,
        warehouse_id: uuid.UUID | None = None,
        unit_cost: Decimal | None = None,
        move_date: date | None = None,
        notes: str = "",
        created_by: str | None = None,
    ) -> StockMovement:
        """Manual correction (+/-) with its own GL entry against the inventory-difference account."""
        day = move_date or date.today()
        mv = await self.move(
            item_id,
            qty,
            "adjustment",
            warehouse_id=warehouse_id,
            unit_cost=unit_cost,
            move_date=day,
            source_type=SOURCE_ADJUST,
            notes=notes,
            created_by=created_by,
        )
        mv.source_id = str(mv.id)
        entry = await self._post_difference(day, mv.value, f"Stock adjustment {notes}".strip(), str(mv.id), created_by)
        mv.gl_entry_id = entry.id if entry else None
        await self.session.flush()
        return mv

    async def _post_difference(self, day: date, value: Decimal, memo: str, source_id: str, by: str | None):
        if value == 0:
            return None
        acc = await self._accounts("inventory", "diff")
        if acc is None:
            return None
        amt = abs(value)
        inv_line = LineInput(acc["inventory"], debit=amt, description=memo)
        diff_line = LineInput(acc["diff"], credit=amt, description=memo)
        if value < 0:
            inv_line = LineInput(acc["inventory"], credit=amt, description=memo)
            diff_line = LineInput(acc["diff"], debit=amt, description=memo)
        return await self._post_gl(day, [inv_line, diff_line], memo, GL_ADJUST, source_id, by)

    # ── Queries ───────────────────────────────────────────────────────────
    async def list_movements(
        self,
        *,
        item_id: uuid.UUID | None = None,
        warehouse_id: uuid.UUID | None = None,
        kinds: list[str] | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        q: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[dict[str, Any]], int]:
        M = StockMovement
        stmt = (
            select(M, Item.sku, Item.name, Item.uom, Warehouse.code)
            .join(Item, Item.id == M.item_id)
            .join(Warehouse, Warehouse.id == M.warehouse_id)
            .where(M.tenant_id == self.tenant_id)
        )
        if item_id:
            stmt = stmt.where(M.item_id == item_id)
        if warehouse_id:
            stmt = stmt.where(M.warehouse_id == warehouse_id)
        if kinds:
            stmt = stmt.where(M.kind.in_(kinds))
        if date_from:
            stmt = stmt.where(M.move_date >= date_from)
        if date_to:
            stmt = stmt.where(M.move_date <= date_to)
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(Item.sku.ilike(like), Item.name.ilike(like), M.source_number.ilike(like)))
        total = await self.session.scalar(select(func.count()).select_from(stmt.subquery())) or 0
        rows = await self.session.execute(
            stmt.order_by(M.move_date.desc(), M.created_at.desc()).limit(limit).offset(offset)
        )
        out = []
        for m, sku, name, uom, wcode in rows:
            out.append(
                {
                    "id": m.id,
                    "item_id": m.item_id,
                    "sku": sku,
                    "item_name": name,
                    "uom": uom,
                    "warehouse_id": m.warehouse_id,
                    "warehouse_code": wcode,
                    "kind": m.kind,
                    "move_date": m.move_date,
                    "qty": m.qty,
                    "unit_cost": m.unit_cost,
                    "value": m.value,
                    "source_type": m.source_type,
                    "source_id": m.source_id,
                    "source_number": m.source_number,
                    "reversal_of_id": m.reversal_of_id,
                    "reversed": m.reversed,
                    "gl_entry_id": m.gl_entry_id,
                    "notes": m.notes,
                    "created_at": m.created_at,
                }
            )
        return out, int(total)

    async def stock_levels(
        self, *, warehouse_id: uuid.UUID | None = None, q: str | None = None, low_only: bool = False
    ) -> list[dict[str, Any]]:
        """One row per stock-tracked item: on hand (total and per warehouse), reserved, available, value."""
        stmt = select(Item).where(Item.tenant_id == self.tenant_id, Item.stock_tracked.is_(True))
        if q:
            like = f"%{q.strip()}%"
            stmt = stmt.where(or_(Item.sku.ilike(like), Item.name.ilike(like)))
        items = list((await self.session.execute(stmt.order_by(Item.sku))).scalars())
        ids = [i.id for i in items]
        per = await self.on_hand_map(ids, warehouse_id)
        reserved = await self.reserved(ids)
        costs = (
            {
                c.item_id: c
                for c in (
                    await self.session.execute(
                        select(ItemCost).where(ItemCost.tenant_id == self.tenant_id, ItemCost.item_id.in_(ids))
                    )
                ).scalars()
            }
            if ids
            else {}
        )
        out = []
        for it in items:
            by_wh = {str(w): qv for (i, w), qv in per.items() if i == it.id and qv != 0}
            on_hand = sum(by_wh.values(), ZERO)
            avg = Decimal(costs[it.id].avg_cost) if it.id in costs else ZERO
            res = reserved.get(str(it.id), ZERO)
            low = Decimal(it.min_stock) > 0 and on_hand < Decimal(it.min_stock)
            if low_only and not low:
                continue
            out.append(
                {
                    "item_id": it.id,
                    "sku": it.sku,
                    "name": it.name,
                    "uom": it.uom,
                    "active": it.active,
                    "on_hand": on_hand,
                    "by_warehouse": by_wh,
                    "reserved": res,
                    "available": on_hand - res,
                    "avg_cost": avg,
                    "value": money(on_hand * avg),
                    "min_stock": it.min_stock,
                    "reorder_qty": it.reorder_qty,
                    "below_min": low,
                }
            )
        return out

    async def item_stock(self, item_id: uuid.UUID) -> dict[str, Any]:
        item = await self.session.get(Item, item_id)
        if item is None or item.tenant_id != self.tenant_id:
            raise InventoryNotFoundError("Item not found")
        whs = await self.list_warehouses()
        per = await self.on_hand_map([item.id])
        cost = await self.session.scalar(
            select(ItemCost).where(ItemCost.tenant_id == self.tenant_id, ItemCost.item_id == item.id)
        )
        res = (await self.reserved([item.id])).get(str(item.id), ZERO)
        rows = [
            {"warehouse_id": w.id, "code": w.code, "name": w.name, "qty": per.get((item.id, w.id), ZERO)}
            for w in whs
            if w.active or per.get((item.id, w.id), ZERO) != 0
        ]
        on_hand = sum((r["qty"] for r in rows), ZERO)
        avg = Decimal(cost.avg_cost) if cost else ZERO
        moves, total = await self.list_movements(item_id=item.id, limit=50)
        return {
            "item_id": item.id,
            "stock_tracked": item.stock_tracked,
            "on_hand": on_hand,
            "reserved": res,
            "available": on_hand - res,
            "avg_cost": avg,
            "value": money(on_hand * avg),
            "warehouses": rows,
            "movements": moves,
            "movement_count": total,
        }

    # ── Stocktakes ────────────────────────────────────────────────────────
    async def get_stocktake(self, st_id: uuid.UUID) -> Stocktake:
        st = await self.session.get(Stocktake, st_id)
        if st is None or st.tenant_id != self.tenant_id:
            raise InventoryNotFoundError("Stocktake not found")
        return st

    async def list_stocktakes(self, limit: int = 200) -> list[Stocktake]:
        q = (
            select(Stocktake)
            .where(Stocktake.tenant_id == self.tenant_id)
            .order_by(Stocktake.count_date.desc(), Stocktake.created_at.desc())
            .limit(limit)
        )
        return list((await self.session.execute(q)).scalars())

    async def create_stocktake(
        self,
        warehouse_id: uuid.UUID | None = None,
        *,
        count_date: date | None = None,
        item_ids: list[uuid.UUID] | None = None,
        notes: str = "",
        created_by: str | None = None,
    ) -> Stocktake:
        """Count sheet pre-filled with the expected quantity of every stock-tracked item in the warehouse."""
        wh = await self._wh(warehouse_id)
        n = await self.session.scalar(select(func.count(Stocktake.id)).where(Stocktake.tenant_id == self.tenant_id))
        stmt = select(Item).where(Item.tenant_id == self.tenant_id, Item.stock_tracked.is_(True))
        if item_ids:
            stmt = stmt.where(Item.id.in_(item_ids))
        items = list((await self.session.execute(stmt.order_by(Item.sku))).scalars())
        per = await self.on_hand_map([i.id for i in items], wh.id)
        st = Stocktake(
            tenant_id=self.tenant_id,
            number=f"ST-{(n or 0) + 1:06d}",
            warehouse_id=wh.id,
            status="draft",
            count_date=count_date or date.today(),
            notes=notes,
            created_by=created_by,
        )
        st.lines = []
        for it in items:
            exp = per.get((it.id, wh.id), ZERO)
            if not it.active and exp == 0:
                continue
            st.lines.append(
                StocktakeLine(
                    line_no=len(st.lines) + 1,
                    item_id=it.id,
                    sku=it.sku,
                    name=it.name,
                    uom=it.uom,
                    expected_qty=exp,
                    counted_qty=None,
                )
            )
        self.session.add(st)
        await self.session.flush()
        return st

    async def update_counts(self, st_id: uuid.UUID, counts: dict[uuid.UUID, Decimal | None], notes: str | None = None):
        st = await self.get_stocktake(st_id)
        if st.status != "draft":
            raise InventoryConflictError(f"Only draft stocktakes can be counted (is {st.status})")
        by_id = {ln.id: ln for ln in st.lines}
        if set(counts) - set(by_id):
            raise InventoryValidationError("Counts reference lines outside this stocktake")
        for lid, qty in counts.items():
            if qty is not None and Decimal(str(qty)) < 0:
                raise InventoryValidationError("Counted quantity cannot be negative")
            ln = by_id[lid]
            ln.counted_qty = None if qty is None else Decimal(str(qty))
            ln.diff_qty = ZERO if qty is None else ln.counted_qty - ln.expected_qty
        if notes is not None:
            st.notes = notes
        await self.session.flush()
        return st

    async def post_stocktake(self, st_id: uuid.UUID, created_by: str | None = None) -> Stocktake:
        """Book counted - on-hand as adjustment movements and one GL entry for the net difference.

        The difference is taken against the live on-hand at posting time, so movements booked
        between counting and posting are not double-counted. Uncounted lines are skipped.
        """
        st = await self.get_stocktake(st_id)
        if st.status != "draft":
            raise InventoryConflictError(f"Stocktake is {st.status}")
        counted = [ln for ln in st.lines if ln.counted_qty is not None]
        if not counted:
            raise InventoryValidationError("Enter at least one counted quantity")
        per = await self.on_hand_map([ln.item_id for ln in counted], st.warehouse_id)
        total = ZERO
        for ln in counted:
            live = per.get((ln.item_id, st.warehouse_id), ZERO)
            ln.expected_qty = live
            ln.diff_qty = Decimal(ln.counted_qty) - live
            if ln.diff_qty == 0:
                ln.diff_value = ZERO
                ln.unit_cost = (await self._cost_row(ln.item_id)).avg_cost
                continue
            mv = await self.move(
                ln.item_id,
                ln.diff_qty,
                "adjustment",
                warehouse_id=st.warehouse_id,
                move_date=st.count_date,
                source_type=SOURCE_STOCKTAKE,
                source_id=str(st.id),
                source_number=st.number,
                notes="Stocktake difference",
                created_by=created_by,
                allow_negative=True,
            )
            ln.unit_cost, ln.diff_value = mv.unit_cost, mv.value
            total += mv.value
        st.diff_value = total
        entry = await self._post_difference(st.count_date, total, f"Stocktake {st.number}", str(st.id), created_by)
        if entry is not None:
            st.gl_entry_id = entry.id
            for m in await self._source_moves(SOURCE_STOCKTAKE, str(st.id)):
                m.gl_entry_id = entry.id
        st.status = "posted"
        await self.session.flush()
        return st

    async def cancel_stocktake(self, st_id: uuid.UUID, created_by: str | None = None) -> Stocktake:
        st = await self.get_stocktake(st_id)
        if st.status == "cancelled":
            raise InventoryConflictError("Stocktake is already cancelled")
        if st.status == "posted":
            await self.reverse_source(SOURCE_STOCKTAKE, str(st.id), created_by=created_by)
            if st.gl_entry_id:
                await self._reverse_gl(st.gl_entry_id, f"Cancel {st.number}", created_by)
        st.status = "cancelled"
        await self.session.flush()
        return st

    async def delete_stocktake(self, st_id: uuid.UUID) -> None:
        st = await self.get_stocktake(st_id)
        if st.status != "draft":
            raise InventoryConflictError("Only draft stocktakes can be deleted")
        await self.session.delete(st)
        await self.session.flush()

    async def summary(self) -> dict[str, Any]:
        levels = await self.stock_levels()
        return {
            "items": len(levels),
            "total_value": sum((r["value"] for r in levels), ZERO),
            "below_min": sum(1 for r in levels if r["below_min"]),
            "out_of_stock": sum(1 for r in levels if r["on_hand"] <= 0),
            "reserved_items": sum(1 for r in levels if r["reserved"] > 0),
            "warehouses": len(await self.list_warehouses(include_inactive=False)),
        }
