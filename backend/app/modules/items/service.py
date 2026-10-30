"""Items service: tenant-scoped CRUD, search, bulk import and price resolution."""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import Select, and_, case, func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.items.models import ITEM_TYPES, Item, ItemDiscountRule, ItemPriceBreak, ItemPriceList, ItemsCategory

ZERO = Decimal(0)
HUNDRED = Decimal(100)
PRICE_Q = Decimal("0.0001")


class ItemsError(Exception):
    pass


class ItemsNotFoundError(ItemsError):
    pass


class ItemsValidationError(ItemsError):
    pass


class ItemsConflictError(ItemsError):
    pass


@dataclass
class PriceResult:
    item_id: uuid.UUID
    currency: str
    qty: Decimal
    list_price: Decimal
    discount_pct: Decimal
    unit_price: Decimal
    source: str
    price_list_id: uuid.UUID | None = None
    discount_rule_id: uuid.UUID | None = None


def _valid_on(valid_from: date | None, valid_to: date | None, on: date) -> bool:
    return (valid_from is None or valid_from <= on) and (valid_to is None or on <= valid_to)


def _check_dates(valid_from: date | None, valid_to: date | None) -> None:
    if valid_from and valid_to and valid_to < valid_from:
        raise ItemsValidationError("valid_to must not be before valid_from")


def pick_break(rows: list[ItemPriceBreak], item_id: uuid.UUID, qty: Decimal) -> ItemPriceBreak | None:
    """Highest quantity break not exceeding ``qty`` for the item."""
    hits = [r for r in rows if r.item_id == item_id and Decimal(r.min_qty) <= qty]
    return max(hits, key=lambda r: Decimal(r.min_qty), default=None)


def list_rank(pl: ItemPriceList, customer_id: uuid.UUID | None, customer_group: str) -> tuple[int, int] | None:
    """Specificity rank (customer > group > generic, then priority); None if not applicable."""
    if pl.customer_id is not None:
        if pl.customer_id != customer_id:
            return None
        spec = 2
    elif pl.customer_group:
        if pl.customer_group != customer_group:
            return None
        spec = 1
    else:
        spec = 0
    return spec, pl.priority


class ItemsService:
    """``tenant_id`` scopes reads (None = unrestricted/admin); ``owner`` stamps new rows."""

    def __init__(self, session: AsyncSession, tenant_id: str | None = None, owner: str | None = None) -> None:
        self.session = session
        self.tenant_id = tenant_id
        self.owner = owner if owner is not None else tenant_id

    def _scoped(self, stmt: Select, model: Any) -> Select:
        return stmt if self.tenant_id is None else stmt.where(model.tenant_id == self.tenant_id)

    async def _get(self, model: Any, obj_id: uuid.UUID, label: str) -> Any:
        stmt = self._scoped(select(model).where(model.id == obj_id), model)
        row = (await self.session.execute(stmt)).scalar_one_or_none()
        if row is None:
            raise ItemsNotFoundError(f"{label} {obj_id} not found")
        return row

    async def _flush(self, new: Any = None) -> None:
        # Savepoint so a duplicate rolls back (and expunges ``new``) without poisoning the session.
        try:
            async with self.session.begin_nested():
                if new is not None:
                    self.session.add(new)
                await self.session.flush()
        except IntegrityError as exc:
            raise ItemsConflictError("Duplicate value (SKU, name or quantity break already exists)") from exc

    # ── Categories ────────────────────────────────────────────────────────
    async def list_categories(self) -> list[ItemsCategory]:
        stmt = self._scoped(select(ItemsCategory).order_by(ItemsCategory.name), ItemsCategory)
        return list((await self.session.execute(stmt)).scalars())

    async def create_category(self, **data: Any) -> ItemsCategory:
        if data.get("parent_id"):
            await self._get(ItemsCategory, data["parent_id"], "Category")
        cat = ItemsCategory(tenant_id=self.owner, **data)
        await self._flush(cat)
        return cat

    async def update_category(self, cat_id: uuid.UUID, **data: Any) -> ItemsCategory:
        cat = await self._get(ItemsCategory, cat_id, "Category")
        if data.get("parent_id") == cat_id:
            raise ItemsValidationError("A category cannot be its own parent")
        for k, v in data.items():
            setattr(cat, k, v)
        await self._flush()
        return cat

    async def delete_category(self, cat_id: uuid.UUID) -> None:
        await self.session.delete(await self._get(ItemsCategory, cat_id, "Category"))
        await self.session.flush()

    # ── Items ─────────────────────────────────────────────────────────────
    async def _check_item(self, data: dict[str, Any]) -> None:
        if "item_type" in data and data["item_type"] not in ITEM_TYPES:
            raise ItemsValidationError(f"Unknown item type {data['item_type']}")
        if data.get("item_type") == "service" and data.get("stock_tracked"):
            raise ItemsValidationError("Services cannot be stock-tracked")
        if data.get("category_id"):
            await self._get(ItemsCategory, data["category_id"], "Category")
        if data.get("currency"):
            data["currency"] = data["currency"].upper()

    def _stock_subq(self):  # noqa: ANN202
        from app.modules.purchasing.models import PurchasingStock

        stmt = select(PurchasingStock.item_id.label("item_id"), func.sum(PurchasingStock.qty).label("qty"))
        if self.tenant_id is not None:
            stmt = stmt.where(PurchasingStock.tenant_id == self.tenant_id)
        return stmt.group_by(PurchasingStock.item_id).subquery()

    async def on_hand(self, item_ids: list[uuid.UUID]) -> dict[str, Decimal]:
        """On-hand quantity from purchasing stock for the given items (missing = 0)."""
        if not item_ids:
            return {}
        sq = self._stock_subq()
        rows = await self.session.execute(select(sq.c.item_id, sq.c.qty).where(sq.c.item_id.in_(item_ids)))
        return {str(i): Decimal(q or 0) for i, q in rows}

    async def list_items(
        self,
        q: str | None = None,
        item_type: str | None = None,
        category_id: uuid.UUID | None = None,
        active: bool | None = None,
        limit: int = 100,
        offset: int = 0,
        tax_code: str | None = None,
        min_price: Decimal | None = None,
        max_price: Decimal | None = None,
        alert: str | None = None,
        sort: str = "sku",
        desc: bool = False,
    ) -> tuple[list[Item], int]:
        stmt = self._scoped(select(Item), Item)
        if q and q.strip():
            term = q.strip()
            like = f"%{term.lower()}%"
            stmt = stmt.where(
                or_(func.lower(Item.sku).like(like), func.lower(Item.name).like(like), Item.barcode == term)
            )
        if item_type:
            stmt = stmt.where(Item.item_type == item_type)
        if category_id:
            stmt = stmt.where(Item.category_id == category_id)
        if active is not None:
            stmt = stmt.where(Item.active.is_(active))
        if tax_code is not None:
            stmt = stmt.where(Item.tax_code == tax_code)
        if min_price is not None:
            stmt = stmt.where(Item.sales_price >= min_price)
        if max_price is not None:
            stmt = stmt.where(Item.sales_price <= max_price)
        if alert == "no_price":
            stmt = stmt.where(Item.sales_price <= 0)
        elif alert == "below_min":
            sq = self._stock_subq()
            stmt = stmt.outerjoin(sq, sq.c.item_id == Item.id).where(
                Item.stock_tracked.is_(True), Item.min_stock > 0, func.coalesce(sq.c.qty, 0) < Item.min_stock
            )
        elif alert:
            raise ItemsValidationError(f"Unknown alert filter {alert}")
        margin = case((Item.sales_price > 0, (Item.sales_price - Item.purchase_cost) / Item.sales_price), else_=None)
        cols = {
            "sku": Item.sku, "name": Item.name, "sales_price": Item.sales_price, "purchase_cost": Item.purchase_cost,
            "item_type": Item.item_type, "uom": Item.uom, "tax_code": Item.tax_code, "updated_at": Item.updated_at,
            "margin": margin,
        }
        if sort not in cols:
            raise ItemsValidationError(f"Cannot sort by {sort}")
        order = cols[sort].desc().nulls_last() if desc else cols[sort].asc().nulls_last()
        total = (await self.session.execute(select(func.count()).select_from(stmt.subquery()))).scalar_one()
        rows = await self.session.execute(stmt.order_by(order, Item.sku).limit(limit).offset(offset))
        return list(rows.scalars()), int(total)

    async def stats(self) -> dict[str, Any]:
        items = list((await self.session.execute(self._scoped(select(Item), Item))).scalars())
        stock = await self.on_hand([i.id for i in items if i.stock_tracked])
        active = [i for i in items if i.active]
        margins = [
            (Decimal(i.sales_price) - Decimal(i.purchase_cost)) / Decimal(i.sales_price) * HUNDRED
            for i in active
            if Decimal(i.sales_price) > 0
        ]
        cats = await self.session.execute(self._scoped(select(func.count(ItemsCategory.id)), ItemsCategory))
        return {
            "total": len(items),
            "active": len(active),
            "inactive": len(items) - len(active),
            "goods": sum(i.item_type == "goods" for i in active),
            "services": sum(i.item_type == "service" for i in active),
            "consumables": sum(i.item_type == "consumable" for i in active),
            "stock_tracked": sum(i.stock_tracked for i in active),
            "avg_margin_pct": (sum(margins) / len(margins)).quantize(Decimal("0.1")) if margins else None,
            "without_price": sum(Decimal(i.sales_price) <= 0 for i in active),
            "below_min_stock": sum(
                i.stock_tracked and Decimal(i.min_stock) > 0 and stock.get(str(i.id), ZERO) < Decimal(i.min_stock)
                for i in active
            ),
            "categories": int(cats.scalar_one()),
        }

    async def category_counts(self) -> list[dict[str, Any]]:
        stmt = self._scoped(select(Item.category_id, func.count(Item.id)), Item).group_by(Item.category_id)
        return [{"category_id": c, "count": int(n)} for c, n in await self.session.execute(stmt)]

    async def bulk(
        self,
        ids: list[uuid.UUID],
        action: str,
        category_id: uuid.UUID | None = None,
        tax_code: str = "",
        pct: Decimal | None = None,
        target: str = "sales",
    ) -> int:
        items = list((await self.session.execute(self._scoped(select(Item).where(Item.id.in_(ids)), Item))).scalars())
        if action == "set_category" and category_id is not None:
            await self._get(ItemsCategory, category_id, "Category")
        if action == "adjust_prices" and pct is None:
            raise ItemsValidationError("A percentage is required to adjust prices")
        factor = (HUNDRED + (pct or ZERO)) / HUNDRED
        cent = Decimal("0.01")
        for it in items:
            if action == "activate":
                it.active = True
            elif action == "deactivate":
                it.active = False
            elif action == "set_category":
                it.category_id = category_id
            elif action == "set_tax_code":
                it.tax_code = tax_code
            elif action == "adjust_prices":
                if target in ("sales", "both"):
                    it.sales_price = (Decimal(it.sales_price) * factor).quantize(cent, rounding=ROUND_HALF_UP)
                if target in ("cost", "both"):
                    it.purchase_cost = (Decimal(it.purchase_cost) * factor).quantize(cent, rounding=ROUND_HALF_UP)
            elif action == "delete":
                await self.session.delete(it)
            else:
                raise ItemsValidationError(f"Unknown bulk action {action}")
        await self._flush()
        return len(items)

    async def duplicate_item(self, item_id: uuid.UUID, created_by: str | None = None) -> Item:
        src = await self.get_item(item_id)
        base = f"{src.sku}-COPY"[:60]
        sku, n = base, 1
        while (await self.session.execute(self._scoped(select(Item.id).where(Item.sku == sku), Item))).first():
            n += 1
            sku = f"{base}{n}"
        skip = {"id", "sku", "tenant_id", "created_by", "created_at", "updated_at"}
        data = {c.key: getattr(src, c.key) for c in Item.__table__.columns if c.key not in skip}
        data["name"] = f"{src.name} (copy)"[:255]
        return await self.create_item(created_by=created_by, sku=sku, **data)

    async def sales_history(self, item_id: uuid.UUID, limit: int = 100) -> list[dict[str, Any]]:
        from app.modules.sales.models import SalesDocument, SalesLine

        item = await self.get_item(item_id)
        # Sales lines carry the SKU, not the item id.
        stmt = (
            select(SalesLine, SalesDocument)
            .join(SalesDocument, SalesDocument.id == SalesLine.document_id)
            .where(SalesLine.sku == item.sku)
        )
        if self.tenant_id is not None:
            stmt = stmt.where(SalesLine.tenant_id == self.tenant_id, SalesDocument.tenant_id == self.tenant_id)
        rows = await self.session.execute(stmt.order_by(SalesDocument.doc_date.desc()).limit(limit))
        return [
            {
                "document_id": d.id, "kind": d.kind, "number": d.number, "status": d.status, "doc_date": d.doc_date,
                "customer_name": d.customer_name, "currency": d.currency, "qty": ln.qty,
                "unit_price": ln.unit_price, "discount_pct": ln.discount_pct, "net": ln.net,
            }
            for ln, d in rows
        ]

    async def purchase_history(self, item_id: uuid.UUID, limit: int = 100) -> list[dict[str, Any]]:
        from app.modules.purchasing.models import PurchasingOrder
        from app.modules.purchasing.models import PurchasingOrderLine as L

        item = await self.get_item(item_id)
        stmt = (
            select(L, PurchasingOrder)
            .join(PurchasingOrder, PurchasingOrder.id == L.order_id)
            .where(or_(L.item_id == item.id, and_(L.item_id.is_(None), L.sku == item.sku)))
        )
        if self.tenant_id is not None:
            stmt = stmt.where(L.tenant_id == self.tenant_id, PurchasingOrder.tenant_id == self.tenant_id)
        rows = await self.session.execute(stmt.order_by(PurchasingOrder.doc_date.desc()).limit(limit))
        return [
            {
                "order_id": o.id, "number": o.number, "status": o.status, "doc_date": o.doc_date,
                "supplier_name": o.supplier_name, "currency": o.currency, "qty": ln.qty,
                "qty_received": ln.qty_received, "unit_price": ln.unit_price, "net": ln.net,
            }
            for ln, o in rows
        ]

    async def item_price_breaks(self, item_id: uuid.UUID) -> list[dict[str, Any]]:
        await self.get_item(item_id)
        stmt = self._scoped(
            select(ItemPriceBreak, ItemPriceList)
            .join(ItemPriceList, ItemPriceList.id == ItemPriceBreak.price_list_id)
            .where(ItemPriceBreak.item_id == item_id),
            ItemPriceList,
        ).order_by(ItemPriceList.name, ItemPriceBreak.min_qty)
        return [
            {
                "price_list_id": pl.id, "price_list_name": pl.name, "currency": pl.currency,
                "customer_group": pl.customer_group, "customer_id": pl.customer_id, "valid_from": pl.valid_from,
                "valid_to": pl.valid_to, "active": pl.active, "min_qty": b.min_qty, "unit_price": b.unit_price,
            }
            for b, pl in await self.session.execute(stmt)
        ]

    async def get_item(self, item_id: uuid.UUID) -> Item:
        return await self._get(Item, item_id, "Item")

    async def create_item(self, created_by: str | None = None, **data: Any) -> Item:
        await self._check_item(data)
        item = Item(tenant_id=self.owner, created_by=created_by, **data)
        await self._flush(item)
        return item

    async def update_item(self, item_id: uuid.UUID, **data: Any) -> Item:
        item = await self.get_item(item_id)
        merged = {"item_type": item.item_type, "stock_tracked": item.stock_tracked, **data}
        await self._check_item(merged)
        for k in data:
            setattr(item, k, merged[k])
        await self._flush()
        return item

    async def delete_item(self, item_id: uuid.UUID) -> None:
        await self.session.delete(await self.get_item(item_id))
        await self.session.flush()

    async def import_items(self, rows: list[dict[str, Any]], created_by: str | None = None) -> tuple[int, int]:
        """Upsert by SKU within the caller's scope."""
        created = updated = 0
        for row in rows:
            stmt = self._scoped(select(Item).where(Item.sku == row["sku"]), Item)
            existing = (await self.session.execute(stmt)).scalar_one_or_none()
            if existing is None:
                await self.create_item(created_by=created_by, **row)
                created += 1
            else:
                await self.update_item(existing.id, **row)
                updated += 1
        return created, updated

    # ── Price lists ───────────────────────────────────────────────────────
    async def list_price_lists(self) -> list[ItemPriceList]:
        stmt = self._scoped(select(ItemPriceList).order_by(ItemPriceList.name), ItemPriceList)
        return list((await self.session.execute(stmt)).scalars())

    async def get_price_list(self, pl_id: uuid.UUID) -> ItemPriceList:
        return await self._get(ItemPriceList, pl_id, "Price list")

    async def _price_rows(self, rows: list[dict[str, Any]]) -> list[ItemPriceBreak]:
        seen: set[tuple[uuid.UUID, Decimal]] = set()
        out = []
        for r in rows:
            key = (r["item_id"], Decimal(r["min_qty"]))
            if key in seen:
                raise ItemsValidationError("Duplicate quantity break for the same item")
            seen.add(key)
            await self.get_item(r["item_id"])
            out.append(ItemPriceBreak(**r))
        return out

    async def create_price_list(self, items: list[dict[str, Any]] | None = None, **data: Any) -> ItemPriceList:
        _check_dates(data.get("valid_from"), data.get("valid_to"))
        data["currency"] = data.get("currency", "EUR").upper()
        pl = ItemPriceList(tenant_id=self.owner, **data)
        pl.items = await self._price_rows(items or [])
        await self._flush(pl)
        return pl

    async def update_price_list(
        self, pl_id: uuid.UUID, items: list[dict[str, Any]] | None = None, **data: Any
    ) -> ItemPriceList:
        pl = await self.get_price_list(pl_id)
        _check_dates(data.get("valid_from", pl.valid_from), data.get("valid_to", pl.valid_to))
        if data.get("currency"):
            data["currency"] = data["currency"].upper()
        for k, v in data.items():
            setattr(pl, k, v)
        if items is not None:
            new_rows = await self._price_rows(items)
            pl.items.clear()
            await self.session.flush()
            pl.items.extend(new_rows)
        await self._flush()
        await self.session.refresh(pl, ["items"])
        return pl

    async def delete_price_list(self, pl_id: uuid.UUID) -> None:
        await self.session.delete(await self.get_price_list(pl_id))
        await self.session.flush()

    # ── Discount rules ────────────────────────────────────────────────────
    async def list_discount_rules(self) -> list[ItemDiscountRule]:
        stmt = self._scoped(select(ItemDiscountRule).order_by(ItemDiscountRule.name), ItemDiscountRule)
        return list((await self.session.execute(stmt)).scalars())

    async def create_discount_rule(self, **data: Any) -> ItemDiscountRule:
        _check_dates(data.get("valid_from"), data.get("valid_to"))
        if data.get("item_id"):
            await self.get_item(data["item_id"])
        if data.get("category_id"):
            await self._get(ItemsCategory, data["category_id"], "Category")
        rule = ItemDiscountRule(tenant_id=self.owner, **data)
        await self._flush(rule)
        return rule

    async def update_discount_rule(self, rule_id: uuid.UUID, **data: Any) -> ItemDiscountRule:
        rule = await self._get(ItemDiscountRule, rule_id, "Discount rule")
        _check_dates(data.get("valid_from", rule.valid_from), data.get("valid_to", rule.valid_to))
        for k, v in data.items():
            setattr(rule, k, v)
        await self._flush()
        return rule

    async def delete_discount_rule(self, rule_id: uuid.UUID) -> None:
        await self.session.delete(await self._get(ItemDiscountRule, rule_id, "Discount rule"))
        await self.session.flush()

    # ── Price resolution ──────────────────────────────────────────────────
    async def resolve_price(
        self,
        item_id: uuid.UUID,
        qty: Decimal = Decimal(1),
        on_date: date | None = None,
        customer_id: uuid.UUID | None = None,
        customer_group: str = "",
        currency: str | None = None,
    ) -> PriceResult:
        """Most specific valid price list wins (customer > group > generic, then priority,
        then highest qty break); falls back to the item sales price. The largest
        applicable discount rule is then applied on top."""
        if qty <= 0:
            raise ItemsValidationError("Quantity must be positive")
        item = await self.get_item(item_id)
        on = on_date or date.today()
        cur = (currency or item.currency).upper()

        stmt = self._scoped(
            select(ItemPriceList).where(ItemPriceList.active.is_(True), ItemPriceList.currency == cur), ItemPriceList
        )
        ranked = []
        for pl in (await self.session.execute(stmt)).scalars():
            rank = list_rank(pl, customer_id, customer_group)
            if rank is not None and _valid_on(pl.valid_from, pl.valid_to, on):
                ranked.append((rank, pl))
        ranked.sort(key=lambda t: t[0], reverse=True)

        list_price: Decimal | None = None
        source, pl_id = "item", None
        for _, pl in ranked:
            row = pick_break(pl.items, item.id, qty)
            if row is not None:
                list_price, source, pl_id = Decimal(row.unit_price), "price_list", pl.id
                break
        if list_price is None:
            if cur != item.currency:
                raise ItemsNotFoundError(f"No {cur} price for item {item.sku}")
            list_price = Decimal(item.sales_price)

        rstmt = self._scoped(select(ItemDiscountRule).where(ItemDiscountRule.active.is_(True)), ItemDiscountRule)
        best: ItemDiscountRule | None = None
        for r in (await self.session.execute(rstmt)).scalars():
            if r.item_id is not None and r.item_id != item.id:
                continue
            if r.category_id is not None and r.category_id != item.category_id:
                continue
            if r.customer_id is not None and r.customer_id != customer_id:
                continue
            if r.customer_group and r.customer_group != customer_group:
                continue
            if Decimal(r.min_qty) > qty or not _valid_on(r.valid_from, r.valid_to, on):
                continue
            if best is None or Decimal(r.discount_pct) > Decimal(best.discount_pct):
                best = r
        disc = Decimal(best.discount_pct) if best else ZERO
        unit = (list_price * (HUNDRED - disc) / HUNDRED).quantize(PRICE_Q, rounding=ROUND_HALF_UP)
        return PriceResult(
            item_id=item.id,
            currency=cur,
            qty=qty,
            list_price=list_price.quantize(PRICE_Q),
            discount_pct=disc,
            unit_price=unit,
            source=source,
            price_list_id=pl_id,
            discount_rule_id=best.id if best else None,
        )
