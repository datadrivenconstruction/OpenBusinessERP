"""Purchasing list page API: filters/sort/paging, stats, duplicate, bulk, activity, related, partial receipts, PDF."""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal

import httpx
import pytest
import pytest_asyncio

from app.dependencies import get_current_company_tenant_id, get_current_user_payload, get_session
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.purchasing import router as po_router
from app.modules.purchasing.service import (
    LineData,
    PurchasingNotFoundError,
    PurchasingService,
    PurchasingValidationError,
)
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 3, 10)
PAST, FUTURE = date(2025, 1, 1), date(2999, 1, 1)
T1, T2 = "tenant-pl-a", "tenant-pl-b"
SUP_A, SUP_B = uuid.uuid4(), uuid.uuid4()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})
    monkeypatch.setattr(po_router, "_company", lambda: {"company_name": "Muster GmbH", "address": "Berlin"})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


@pytest_asyncio.fixture
async def svc(session):
    gl = GLService(session, T1)
    await gl.load_template("de_skr03")
    await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
    return PurchasingService(session, T1)


def lines(*qtys, price="10"):
    return [LineData(f"Part {i}", f"P{i}", D(q), D(price), D(19)) for i, q in enumerate(qtys, start=1)]


async def po(svc, *, qtys=(10,), confirm=False, **kw):
    kw.setdefault("doc_date", DAY)
    kw.setdefault("supplier_name", "Lieferant GmbH")
    order = await svc.create_order(lines=lines(*qtys), **kw)
    if confirm:
        await svc.set_order_status(order.id, "confirmed")
    return order


async def bill(svc, *, qtys=(10,), post=False, **kw):
    kw.setdefault("doc_date", DAY)
    kw.setdefault("supplier_name", "Lieferant GmbH")
    b = await svc.create_bill("bill", lines=lines(*qtys), **kw)
    if post:
        await svc.post_bill(b.id)
    return b


async def test_order_filters_sort_paging(svc):
    a = await po(svc, supplier_name="Alpha", supplier_id=SUP_A, confirm=True, due_date=PAST)
    b = await po(svc, supplier_name="Beta", supplier_id=SUP_B, doc_date=date(2026, 4, 1), qtys=(50,), due_date=FUTURE)
    c = await po(svc, supplier_name="Alpha", supplier_id=SUP_A, doc_date=date(2026, 5, 1))
    rows, total = await svc.query_orders()
    assert total == 3 and [r.id for r in rows] == [c.id, b.id, a.id]
    assert {r.id for r in (await svc.query_orders(statuses=["draft"]))[0]} == {b.id, c.id}
    assert (await svc.query_orders(supplier_id=SUP_B))[1] == 1
    assert {r.id for r in (await svc.query_orders(q="alp"))[0]} == {a.id, c.id}
    assert [r.id for r in (await svc.query_orders(q=b.number))[0]] == [b.id]
    assert [r.id for r in (await svc.query_orders(date_from=date(2026, 4, 1), date_to=date(2026, 4, 30)))[0]] == [b.id]
    assert [r.id for r in (await svc.query_orders(overdue=True))[0]] == [a.id]  # late delivery
    assert (await svc.query_orders(sort="-gross_total"))[0][0].id == b.id
    assert (await svc.query_orders(sort="supplier_name"))[0][-1].id == b.id
    rows, total = await svc.query_orders(sort="number", limit=1, offset=2)
    assert total == 3 and rows[0].id == c.id
    with pytest.raises(PurchasingValidationError):
        await svc.query_orders(sort="balance")


async def test_bill_filters_overdue_match(svc):
    a = await bill(svc, supplier_name="Alpha", supplier_id=SUP_A, post=True, due_date=PAST)
    b = await bill(svc, supplier_name="Beta", supplier_id=SUP_B, post=True, due_date=FUTURE, qtys=(30,))
    await svc.record_payment(b.id, amount=D("100"))
    c = await bill(svc, supplier_name="Alpha", supplier_id=SUP_A)  # draft
    o = await po(svc, confirm=True)
    await svc.receive(o.id, {o.lines[0].id: D(10)})
    m = await svc.bill_from_order(o.id)  # matched against the receipt

    rows, total = await svc.query_bills("bill", overdue=True)
    assert [r.id for r in rows] == [a.id] and rows[0].is_overdue and rows[0].balance_due == D("119.00")
    assert not b.is_overdue and not c.is_overdue
    assert {r.id for r in (await svc.query_bills("bill", overdue=False))[0]} == {b.id, c.id, m.id}
    assert [r.id for r in (await svc.query_bills("bill", match=["matched"]))[0]] == [m.id]
    assert [r.id for r in (await svc.query_bills("bill", statuses=["partially_paid"]))[0]] == [b.id]
    assert (await svc.query_bills("bill", supplier_id=SUP_A))[1] == 2
    assert (await svc.query_bills("bill", sort="-balance"))[0][0].id == b.id
    assert (await svc.query_bills("bill", q="beta"))[0][0].id == b.id
    assert (await svc.query_bills("credit_note"))[1] == 0
    with pytest.raises(PurchasingValidationError):
        await svc.query_bills("bill", sort="nope")


async def test_stats(svc):
    today = date(2026, 6, 15)
    o1 = await po(svc, confirm=True, qtys=(10, 10))  # 238 gross
    await po(svc)  # draft: not open
    await svc.receive(o1.id, {o1.lines[0].id: D(10)})  # first line fully received, second open
    o2 = await po(svc, confirm=True, qtys=(1,))
    await svc.receive(o2.id)  # fully received -> still open PO, nothing to receive
    await bill(svc, post=True, due_date=today + timedelta(days=3), qtys=(10,))  # due in week 119
    await bill(svc, post=True, due_date=today + timedelta(days=30))  # later
    ov = await bill(svc, post=True, due_date=today - timedelta(days=2), qtys=(20,))  # overdue 238
    await svc.record_payment(ov.id, amount=D("38"))
    st = await svc.stats(today)
    assert st["currency"] == "EUR"
    assert st["open_po_count"] == 2 and st["open_po_value"] == D("249.90")
    assert st["to_receive_count"] == 1 and st["to_receive_value"] == D("119.00")
    assert st["bills_due_week_count"] == 1 and st["bills_due_week_value"] == D("119.00")
    assert st["overdue_count"] == 1 and st["overdue_value"] == D("200.00")


async def test_duplicate(svc):
    o = await po(svc, qtys=(2, 3), confirm=True, due_date=DAY + timedelta(days=10), notes="n")
    await svc.receive(o.id)
    cp = await svc.duplicate_order(o.id)
    assert cp.id != o.id and cp.number != o.number and cp.status == "draft" and cp.doc_date == date.today()
    assert (cp.due_date - cp.doc_date).days == 10 and [l.qty for l in cp.lines] == [D(2), D(3)]
    assert all(l.qty_received == 0 and l.qty_billed == 0 for l in cp.lines) and cp.notes == "n"

    b = await bill(svc, qtys=(1, 2), post=True, supplier_ref="X-1")
    await svc.record_payment(b.id, amount=D("10"))
    bc = await svc.duplicate_bill(b.id, "bill")
    assert bc.status == "draft" and bc.number != b.number and bc.payments == [] and bc.amount_paid == 0
    assert bc.order_id is None and bc.source_id is None and bc.gl_entry_id is None and bc.gross_total == b.gross_total
    with pytest.raises(PurchasingNotFoundError):
        await svc.duplicate_bill(b.id, "credit_note")


async def test_bulk(svc):
    o1, o2 = await po(svc), await po(svc)
    await svc.set_order_status(o2.id, "confirmed")
    res = await svc.bulk("order", "mark_sent", [o1.id, o2.id, uuid.uuid4()])
    assert res["processed"] == 1 and len(res["skipped"]) == 2 and res["drafts"] == []
    assert (await svc.get_order(o1.id)).status == "confirmed"

    res = await svc.bulk("order", "delete_drafts", [o1.id, (await po(svc)).id])
    assert res["processed"] == 1 and res["skipped"][0]["id"] == o1.id

    b1, b2 = await bill(svc), await bill(svc, post=True)
    res = await svc.bulk("bill", "delete_drafts", [b1.id, b2.id])
    assert res["processed"] == 1 and res["skipped"][0]["id"] == b2.id
    res = await svc.bulk("bill", "reminder_drafts", [b2.id])
    assert res["processed"] == 0 and len(res["skipped"]) == 1 and res["drafts"] == []
    assert (await svc.bulk("bill", "mark_sent", [b2.id]))["processed"] == 0
    with pytest.raises(PurchasingValidationError):
        await svc.bulk("bill", "boom", [b2.id])


async def test_partial_receive_exposes_remaining(svc):
    o = await po(svc, qtys=(10, 4), confirm=True)
    assert o.received_pct == 0 and [l.remaining_qty for l in o.lines] == [D(10), D(4)]
    await svc.receive(o.id, {o.lines[0].id: D(5)})
    assert o.status == "partially_received" and [l.qty_received for l in o.lines] == [D(5), D(0)]
    assert [l.remaining_qty for l in o.lines] == [D(5), D(4)]
    assert o.received_pct == pytest.approx(5 / 14)
    with pytest.raises(PurchasingValidationError):
        await svc.receive(o.id, {o.lines[0].id: D(6)})
    await svc.receive(o.id)
    assert o.received_pct == 1.0 and o.status == "received"


async def test_related_and_activity(svc):
    o = await po(svc, confirm=True)
    gr = await svc.receive(o.id, {o.lines[0].id: D(4)})
    b = await svc.bill_from_receipt(gr.id)
    await svc.post_bill(b.id)
    await svc.record_payment(b.id, amount=D("10"))
    cn = await svc.create_bill("credit_note", lines=lines(1), source_id=b.id, doc_date=DAY)

    rel = await svc.order_related(o.id)
    assert rel["source"] is None
    assert [r.id for r in rel["derived"]["receipts"]] == [gr.id] and [x.id for x in rel["derived"]["bills"]] == [b.id]
    brel = await svc.bill_related(b.id, "bill")
    assert brel["source"]["order"].id == o.id and brel["source"]["receipt"].id == gr.id
    assert [c.id for c in brel["derived"]] == [cn.id]
    assert (await svc.bill_related(cn.id, "credit_note"))["source"]["bill"].id == b.id
    assert (await svc.bill_related((await bill(svc)).id))["source"] is None

    ev = await svc.order_activity(o.id)
    assert {e["type"] for e in ev} == {"created", "receipt", "bill"}
    assert [e["at"] for e in ev] == sorted((e["at"] for e in ev), reverse=True)
    ev = await svc.bill_activity(b.id, "bill")
    assert {e["type"] for e in ev} == {"created", "posted", "payment", "credit_note"}


async def test_tenant_isolation(session, svc):
    other = PurchasingService(session, T2)
    mine = await po(svc, supplier_name="Mine", confirm=True, due_date=PAST)
    mb = await bill(svc, supplier_name="Mine", post=True, due_date=PAST)
    theirs = await po(other, supplier_name="Theirs")
    assert [r.id for r in (await svc.query_orders())[0]] == [mine.id]
    assert (await svc.query_orders(q="Theirs"))[1] == 0 and (await other.query_bills("bill"))[1] == 0
    assert (await other.stats())["overdue_count"] == 0 and (await svc.stats())["overdue_count"] == 1
    for call in (
        other.duplicate_order(mine.id),
        other.order_activity(mine.id),
        other.order_related(mine.id),
        other.duplicate_bill(mb.id),
        other.bill_activity(mb.id),
        other.bill_related(mb.id),
    ):
        with pytest.raises(PurchasingNotFoundError):
            await call
    res = await svc.bulk("order", "delete_drafts", [theirs.id])
    assert res["processed"] == 0 and res["skipped"][0]["reason"] == "not found"


@pytest_asyncio.fixture
async def client(session, svc):
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(po_router.router, prefix="/api/v1/purchasing")

    async def _session():
        yield session

    async def _payload():
        return {"sub": "u1", "role": "admin"}

    async def _tenant():
        return T1

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_current_user_payload] = _payload
    app.dependency_overrides[get_current_company_tenant_id] = _tenant
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def test_http_contract(client, svc):
    base = "/api/v1/purchasing"
    o = await po(svc, qtys=(10, 4), confirm=True)
    await po(svc, supplier_name="Zeta")
    r = await client.get(f"{base}/orders/", params={"status": "confirmed,draft", "limit": 1, "sort": "supplier_name"})
    assert r.status_code == 200 and r.headers["X-Total-Count"] == "2" and len(r.json()) == 1
    assert r.json()[0]["received_pct"] == 0.0
    assert (await client.get(f"{base}/orders/", params={"status_filter": "draft"})).headers["X-Total-Count"] == "1"

    r = await client.post(
        f"{base}/orders/{o.id}/receive/", json={"lines": [{"order_line_id": str(o.lines[0].id), "qty": "5"}]}
    )
    assert r.status_code == 201
    got = (await client.get(f"{base}/orders/{o.id}/")).json()
    assert [(Decimal(l["qty_received"]), Decimal(l["remaining_qty"])) for l in got["lines"]] == [
        (D(5), D(5)),
        (D(0), D(4)),
    ]

    assert (await client.get(f"{base}/stats/")).json()["open_po_count"] == 1  # static route not shadowed
    r = await client.post(f"{base}/orders/{o.id}/duplicate/")
    assert r.status_code == 201 and r.json()["status"] == "draft"
    r = await client.post(f"{base}/orders/bulk/", json={"action": "delete_drafts", "ids": [r.json()["id"], str(o.id)]})
    assert r.json()["processed"] == 1 and len(r.json()["skipped"]) == 1
    rel = (await client.get(f"{base}/orders/{o.id}/related/")).json()
    assert rel["source"] is None and len(rel["derived"]["receipts"]) == 1 and rel["derived"]["bills"] == []
    assert (await client.get(f"{base}/orders/{o.id}/activity/")).status_code == 200

    b = await bill(svc, post=True, due_date=PAST)
    r = await client.get(f"{base}/bills/", params={"overdue": "true", "match": "none"})
    assert r.headers["X-Total-Count"] == "1" and r.json()[0]["is_overdue"] is True
    assert Decimal(r.json()[0]["balance_due"]) == D("119.00")
    assert (await client.post(f"{base}/bills/bulk/", json={"action": "reminder_drafts", "ids": [str(b.id)]})).json()[
        "processed"
    ] == 0
    assert (await client.post(f"{base}/bills/{b.id}/duplicate/")).status_code == 201
    assert (await client.get(f"{base}/bills/{b.id}/related/")).json() == {"source": None, "derived": []}
    assert (await client.get(f"{base}/bills/{b.id}/activity/")).status_code == 200

    for url in (f"{base}/orders/{o.id}/pdf/", f"{base}/bills/{b.id}/pdf/"):
        r = await client.get(url)
        assert r.status_code == 200 and r.content.startswith(b"%PDF") and r.headers["content-type"] == "application/pdf"


async def test_line_discount_round_trip(svc):
    o = await svc.create_order(
        lines=[LineData("Disc", "D", D(10), D(10), D(19), discount_pct=D(10))], supplier_name="S", doc_date=DAY
    )
    assert o.lines[0].discount_pct == D(10) and o.net_total == D("90.00") and o.gross_total == D("107.10")
    await svc.set_order_status(o.id, "confirmed")
    gr = await svc.receive(o.id)
    assert gr.value_total == D("90.00")  # receipt valued at the discounted price
    b = await svc.bill_from_order(o.id)
    assert b.lines[0].discount_pct == D(10) and b.net_total == D("90.00") and b.match_status == "matched"
    cp = await svc.duplicate_order(o.id)
    assert cp.lines[0].discount_pct == D(10) and cp.net_total == D("90.00")
    with pytest.raises(PurchasingValidationError):
        await svc.create_order(lines=[LineData("x", "x", D(1), D(1), D(0), discount_pct=D(101))])
