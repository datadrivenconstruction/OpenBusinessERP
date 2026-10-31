"""Inventory: moving-average math, receipt/delivery hooks, transfers, stocktake GL, negative-stock guard."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.inventory.service import (
    CostState,
    InventoryConflictError,
    InventoryService,
    apply_cost,
    reverse_cost,
)
from app.modules.items.models import Item
from app.modules.purchasing.service import LineData as PLine
from app.modules.purchasing.service import PurchasingConflictError, PurchasingService
from app.modules.sales.service import LineData as SLine
from app.modules.sales.service import SalesConflictError, SalesService
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 3, 10)
T1 = "tenant-inv-a"


def test_moving_average_math():
    s, dv = apply_cost(CostState(), D(10), D(10))
    assert (s.qty, s.value, s.avg, dv) == (D(10), D("100.00"), D(10), D("100.00"))
    s, dv = apply_cost(s, D(10), D(13))
    assert (s.qty, s.value, s.avg) == (D(20), D("230.00"), D("11.5"))
    s, dv = apply_cost(s, D(-4))
    assert dv == D("-46.00") and s.avg == D("11.5") and s.value == D("184.00")
    s, dv = apply_cost(CostState(D(3), D("10.00"), D("3.333333")), D(-3))
    assert dv == D("-10.00") and s.value == 0 and s.qty == 0  # last unit clears rounding residue
    r = reverse_cost(CostState(D(20), D("230.00"), D("11.5")), D(10), D("130.00"))
    assert (r.qty, r.value, r.avg) == (D(10), D("100.00"), D(10))


@pytest.fixture(autouse=True)
def _base_eur(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        gl = GLService(s, T1)
        await gl.load_template("de_skr03")
        await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
        yield s


async def _item(session, sku="W-1", cost="10"):
    it = Item(tenant_id=T1, sku=sku, name="Widget", purchase_cost=D(cost), stock_tracked=True, min_stock=D(5))
    session.add(it)
    await session.flush()
    return it


async def _closing(session, code):
    tb = await GLService(session, T1).trial_balance(None, None)
    row = next((r for r in tb["rows"] if r["code"] == code), None)
    return row["closing"] if row else D(0)


async def _receive(session, item, qty, price):
    p = PurchasingService(session, T1)
    po = await p.create_order(
        supplier_name="Supplier", doc_date=DAY, lines=[PLine("Widget", item.sku, D(qty), D(price), D(19), item.id)]
    )
    await p.set_order_status(po.id, "confirmed")
    return p, await p.receive(po.id, None, doc_date=DAY)


async def test_receipt_delivery_cogs_and_reversals(session):
    inv = InventoryService(session, T1)
    item = await _item(session)
    await _receive(session, item, 10, "10")
    p, gr2 = await _receive(session, item, 10, "13")
    assert (await inv.on_hand([item.id]))[str(item.id)] == D(20)
    lvl = await inv.item_stock(item.id)
    assert lvl["avg_cost"] == D("11.5") and lvl["value"] == D("230.00") and lvl["warehouses"][0]["code"] == "MAIN"

    sales = SalesService(session, T1)
    so = await sales.create(
        "order", customer_name="ACME", doc_date=DAY, lines=[SLine("Widget", item.sku, D(4), D(30), item_id=item.id)]
    )
    await sales.set_status(so.id, "confirmed")
    assert (await inv.reserved([item.id]))[str(item.id)] == D(4)
    await sales.set_status(so.id, "delivered")
    assert (await inv.on_hand([item.id]))[str(item.id)] == D(16)
    assert await inv.reserved([item.id]) == {}
    assert await _closing(session, "3400") == D("46.00")  # COGS at 4 x 11.50, once
    assert await _closing(session, "3980") == D("184.00")

    # Cancel the delivery: stock back, COGS reversed.
    await sales.set_status(so.id, "cancelled")
    assert (await inv.on_hand([item.id]))[str(item.id)] == D(20)
    assert await _closing(session, "3400") == 0 and await _closing(session, "3980") == D("230.00")

    # Cancel a receipt: stock and average restored, GRNI entry reversed.
    await p.cancel_receipt(gr2.id)
    st = await inv.item_stock(item.id)
    assert st["on_hand"] == D(10) and st["avg_cost"] == D(10) and await _closing(session, "3980") == D("100.00")
    with pytest.raises(PurchasingConflictError):
        await p.cancel_receipt(gr2.id)


async def test_negative_stock_guard_and_setting(session):
    inv = InventoryService(session, T1)
    item = await _item(session)
    await inv.opening(item.id, D(2), D(5), move_date=DAY)
    sales = SalesService(session, T1)
    so = await sales.create(
        "order", customer_name="ACME", doc_date=DAY, lines=[SLine("Widget", item.sku, D(3), D(30), item_id=item.id)]
    )
    await sales.set_status(so.id, "confirmed")
    with pytest.raises(SalesConflictError):
        await sales.set_status(so.id, "delivered")
    await inv.update_settings(allow_negative=True)
    await sales.set_status(so.id, "delivered")
    assert (await inv.on_hand([item.id]))[str(item.id)] == D(-1)


async def test_transfer_and_stocktake_adjustment(session):
    inv = InventoryService(session, T1)
    item = await _item(session)
    main = await inv.default_warehouse()
    van = await inv.create_warehouse("VAN", "Service van")
    await inv.opening(item.id, D(10), D(8), move_date=DAY)
    await inv.transfer(item.id, main.id, van.id, D(4), move_date=DAY)
    per = await inv.on_hand_map([item.id])
    assert per[(item.id, main.id)] == D(6) and per[(item.id, van.id)] == D(4)
    assert (await inv.item_stock(item.id))["avg_cost"] == D(8)  # transfers keep value
    with pytest.raises(InventoryConflictError):
        await inv.transfer(item.id, van.id, main.id, D(5))

    st = await inv.create_stocktake(main.id, count_date=DAY)
    [ln] = st.lines
    assert ln.expected_qty == D(6)
    await inv.update_counts(st.id, {ln.id: D(5)})
    await inv.post_stocktake(st.id)
    assert st.status == "posted" and st.diff_value == D("-8.00") and st.gl_entry_id is not None
    assert (await inv.on_hand_map([item.id]))[(item.id, main.id)] == D(5)
    assert await _closing(session, "4900") == D("8.00")  # shrinkage expensed
    assert await inv.stock_levels(low_only=True) == []  # 9 on hand, min 5
    await inv.cancel_stocktake(st.id)
    assert (await inv.on_hand_map([item.id]))[(item.id, main.id)] == D(6) and await _closing(session, "4900") == 0
