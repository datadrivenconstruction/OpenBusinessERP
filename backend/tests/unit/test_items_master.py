"""Items: CRUD/search, tenant isolation, import upsert, price lists, qty breaks, discounts."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.items.service import (
    ItemsConflictError,
    ItemsNotFoundError,
    ItemsService,
    ItemsValidationError,
)
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 3, 10)
T1, T2 = str(uuid.uuid4()), str(uuid.uuid4())
CUST = uuid.uuid4()


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


@pytest_asyncio.fixture
async def svc(session):
    return ItemsService(session, tenant_id=T1)


async def _widget(svc, sku="W-1", **kw):
    data = {"name": "Widget", "item_type": "goods", "sales_price": D("10"), "currency": "EUR", **kw}
    return await svc.create_item(sku=sku, **data)


async def test_crud_and_search(svc):
    cat = await svc.create_category(name="Hardware")
    await _widget(svc, category_id=cat.id, barcode="4006381333931")
    await svc.create_item(sku="SVC-1", name="Consulting hour", item_type="service", uom="h")
    rows, total = await svc.list_items(q="widg")
    assert total == 1 and rows[0].sku == "W-1"
    assert (await svc.list_items(q="4006381333931"))[1] == 1
    assert (await svc.list_items(item_type="service"))[1] == 1
    assert (await svc.list_items(category_id=cat.id))[1] == 1
    item = rows[0]
    await svc.update_item(item.id, active=False, currency="usd")
    assert item.currency == "USD"
    assert (await svc.list_items(active=True))[1] == 1
    with pytest.raises(ItemsConflictError):
        await _widget(svc)
    with pytest.raises(ItemsValidationError):
        await svc.create_item(sku="S2", name="x", item_type="service", stock_tracked=True)
    await svc.delete_item(item.id)
    with pytest.raises(ItemsNotFoundError):
        await svc.get_item(item.id)


async def test_tenant_isolation(session, svc):
    item = await _widget(svc)
    other = ItemsService(session, tenant_id=T2)
    assert (await other.list_items())[1] == 0
    with pytest.raises(ItemsNotFoundError):
        await other.get_item(item.id)
    await _widget(other)  # same SKU allowed in another tenant
    admin = ItemsService(session, tenant_id=None, owner=T2)
    assert (await admin.list_items())[1] == 2


async def test_import_upsert(svc):
    created, updated = await svc.import_items(
        [{"sku": "A", "name": "Alpha"}, {"sku": "B", "name": "Beta", "sales_price": D("5")}]
    )
    assert (created, updated) == (2, 0)
    created, updated = await svc.import_items([{"sku": "A", "name": "Alpha v2"}])
    assert (created, updated) == (0, 1)
    rows, _ = await svc.list_items(q="alpha")
    assert rows[0].name == "Alpha v2"


async def test_price_resolution(svc):
    cat = await svc.create_category(name="Parts")
    item = await _widget(svc, category_id=cat.id)
    # No list -> item price.
    res = await svc.resolve_price(item.id, D(1), DAY)
    assert (res.unit_price, res.source) == (D("10.0000"), "item")

    await svc.create_price_list(
        name="Generic", currency="EUR",
        items=[{"item_id": item.id, "min_qty": D(0), "unit_price": D("9")},
               {"item_id": item.id, "min_qty": D(10), "unit_price": D("8")}],
    )
    assert (await svc.resolve_price(item.id, D(5), DAY)).unit_price == D("9.0000")
    assert (await svc.resolve_price(item.id, D(10), DAY)).unit_price == D("8.0000")

    vip = await svc.create_price_list(
        name="VIP", customer_group="vip", valid_from=date(2026, 1, 1), valid_to=date(2026, 6, 30),
        items=[{"item_id": item.id, "min_qty": D(0), "unit_price": D("7.5")}],
    )
    res = await svc.resolve_price(item.id, D(1), DAY, customer_group="vip")
    assert (res.unit_price, res.price_list_id) == (D("7.5000"), vip.id)
    # Outside validity -> falls back to generic list.
    assert (await svc.resolve_price(item.id, D(1), date(2026, 7, 1), customer_group="vip")).unit_price == D("9.0000")

    await svc.create_price_list(
        name="ACME", customer_id=CUST, items=[{"item_id": item.id, "min_qty": D(0), "unit_price": D("7")}]
    )
    assert (await svc.resolve_price(item.id, D(1), DAY, customer_id=CUST, customer_group="vip")).unit_price == D("7.0000")

    # Largest applicable discount wins; min_qty respected.
    await svc.create_discount_rule(name="Cat 5%", category_id=cat.id, discount_pct=D(5))
    big = await svc.create_discount_rule(name="Bulk 12.5%", item_id=item.id, min_qty=D(20), discount_pct=D("12.5"))
    res = await svc.resolve_price(item.id, D(5), DAY)
    assert (res.discount_pct, res.unit_price) == (D(5), D("8.5500"))
    res = await svc.resolve_price(item.id, D(20), DAY)
    assert (res.discount_rule_id, res.unit_price) == (big.id, D("7.0000"))

    with pytest.raises(ItemsNotFoundError):
        await svc.resolve_price(item.id, D(1), DAY, currency="USD")
    with pytest.raises(ItemsValidationError):
        await svc.resolve_price(item.id, D(0), DAY)


async def test_price_list_validation_and_replace(svc):
    item = await _widget(svc)
    with pytest.raises(ItemsValidationError):
        await svc.create_price_list(name="Bad", valid_from=date(2026, 2, 1), valid_to=date(2026, 1, 1))
    with pytest.raises(ItemsValidationError):
        await svc.create_price_list(
            name="Dup", items=[{"item_id": item.id, "min_qty": D(1), "unit_price": D(1)}] * 2
        )
    pl = await svc.create_price_list(name="L", items=[{"item_id": item.id, "min_qty": D(0), "unit_price": D(3)}])
    pl = await svc.update_price_list(pl.id, items=[{"item_id": item.id, "min_qty": D(5), "unit_price": D(2)}])
    assert [(r.min_qty, r.unit_price) for r in pl.items] == [(D(5), D(2))]
