"""Items: stats, filters/sort, bulk actions, duplicate, stock, sales/purchase history, price breaks."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.inventory.models import StockMovement, Warehouse
from app.modules.items.service import ItemsService, ItemsValidationError
from app.modules.purchasing.models import PurchasingOrder, PurchasingOrderLine
from app.modules.sales.models import SalesDocument, SalesLine
from tests._pg import transactional_session

D = Decimal
T1, T2 = str(uuid.uuid4()), str(uuid.uuid4())


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


@pytest_asyncio.fixture
async def svc(session):
    return ItemsService(session, tenant_id=T1)


async def _seed(svc):
    a = await svc.create_item(
        sku="A",
        name="Anchor",
        sales_price=D("10"),
        purchase_cost=D("6"),
        stock_tracked=True,
        min_stock=D("5"),
        tax_code="std",
    )
    b = await svc.create_item(sku="B", name="Bolt", sales_price=D("0"), purchase_cost=D("1"))
    c = await svc.create_item(
        sku="C", name="Consulting", item_type="service", sales_price=D("100"), purchase_cost=D("50"), tax_code="std"
    )
    return a, b, c


async def test_stats_and_alerts(session, svc):
    a, b, _c = await _seed(svc)
    for tenant, qty in ((T1, "2"), (T2, "50")):  # other tenant ignored
        wh = Warehouse(tenant_id=tenant, code="MAIN", name="Main", is_default=True)
        session.add(wh)
        await session.flush()
        session.add(
            StockMovement(
                tenant_id=tenant, item_id=a.id, warehouse_id=wh.id, kind="opening", move_date=date.today(), qty=D(qty)
            )
        )
    await session.flush()
    st = await svc.stats()
    assert (st["active"], st["goods"], st["services"]) == (3, 2, 1)
    assert st["without_price"] == 1 and st["below_min_stock"] == 1
    assert st["avg_margin_pct"] == D("45.0")  # (40 + 50) / 2, zero-price item excluded
    assert (await svc.on_hand([a.id])) == {str(a.id): D("2")}
    assert [i.sku for i in (await svc.list_items(alert="below_min"))[0]] == ["A"]
    assert [i.sku for i in (await svc.list_items(alert="no_price"))[0]] == ["B"]
    with pytest.raises(ItemsValidationError):
        await svc.list_items(alert="nope")


async def test_filters_and_sort(svc):
    await _seed(svc)
    assert [i.sku for i in (await svc.list_items(sort="sales_price", desc=True))[0]] == ["C", "A", "B"]
    assert [i.sku for i in (await svc.list_items(sort="margin", desc=True))[0]][:2] == ["C", "A"]
    assert (await svc.list_items(tax_code="std"))[1] == 2
    assert [i.sku for i in (await svc.list_items(min_price=D("5"), max_price=D("50")))[0]] == ["A"]
    with pytest.raises(ItemsValidationError):
        await svc.list_items(sort="tenant_id")


async def test_bulk_actions_are_tenant_scoped(session, svc):
    a, b, c = await _seed(svc)
    other = await ItemsService(session, tenant_id=T2).create_item(sku="X", name="Foreign", sales_price=D("10"))
    cat = await svc.create_category(name="Fixings")
    assert await svc.bulk([a.id, b.id, other.id], "deactivate") == 2
    assert not a.active and other.active
    await svc.bulk([a.id, b.id], "set_category", category_id=cat.id)
    await svc.bulk([b.id], "set_tax_code", tax_code="red")
    await svc.bulk([a.id, c.id], "adjust_prices", pct=D("10"), target="both")
    assert (a.sales_price, a.purchase_cost, c.sales_price) == (D("11.00"), D("6.60"), D("110.00"))
    assert other.sales_price == D("10")
    assert b.category_id == cat.id and b.tax_code == "red"
    counts = {r["category_id"]: r["count"] for r in await svc.category_counts()}
    assert counts[cat.id] == 2 and counts[None] == 1
    with pytest.raises(ItemsValidationError):
        await svc.bulk([a.id], "adjust_prices")
    assert await svc.bulk([b.id], "delete") == 1
    assert (await svc.list_items())[1] == 2


async def test_duplicate_gets_free_sku(svc):
    a, *_ = await _seed(svc)
    first = await svc.duplicate_item(a.id)
    second = await svc.duplicate_item(a.id)
    assert (first.sku, second.sku) == ("A-COPY", "A-COPY2")
    assert first.min_stock == D("5") and first.name == "Anchor (copy)"


async def test_history_and_price_breaks(session, svc):
    a, *_ = await _seed(svc)
    doc = SalesDocument(tenant_id=T1, kind="invoice", number="INV-1", doc_date=date(2026, 5, 1), customer_name="Acme")
    doc.lines = [SalesLine(tenant_id=T1, sku="A", qty=D("3"), unit_price=D("10"), net=D("30"))]
    foreign = SalesDocument(tenant_id=T2, kind="invoice", number="INV-9", doc_date=date(2026, 5, 2))
    foreign.lines = [SalesLine(tenant_id=T2, sku="A", qty=D("1"))]
    po = PurchasingOrder(tenant_id=T1, number="PO-1", doc_date=date(2026, 4, 1), supplier_name="Supply Co")
    po.lines = [PurchasingOrderLine(tenant_id=T1, item_id=a.id, sku="A", qty=D("20"), unit_price=D("6"))]
    session.add_all([doc, foreign, po])
    await session.flush()
    sales = await svc.sales_history(a.id)
    assert [(r["number"], r["qty"]) for r in sales] == [("INV-1", D("3"))]
    buys = await svc.purchase_history(a.id)
    assert buys[0]["supplier_name"] == "Supply Co" and buys[0]["qty"] == D("20")
    await svc.create_price_list(name="Trade", items=[{"item_id": a.id, "min_qty": D("10"), "unit_price": D("9")}])
    rows = await svc.item_price_breaks(a.id)
    assert [(r["price_list_name"], r["unit_price"]) for r in rows] == [("Trade", D("9"))]
