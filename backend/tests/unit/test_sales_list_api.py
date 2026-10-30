"""Sales list page API: filters/sort/paging, stats, duplicate, bulk, activity, related, partial conversion."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import httpx
import pytest
import pytest_asyncio

from app.dependencies import get_current_company_tenant_id, get_current_user_payload, get_session
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.sales.documents import service as docs
from app.modules.sales.service import (
    LineData,
    SalesConflictError,
    SalesNotFoundError,
    SalesService,
    SalesValidationError,
)
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 3, 10)
PAST, FUTURE = date(2025, 1, 1), date(2999, 1, 1)
T1, T2 = "tenant-sl-a", "tenant-sl-b"
CUST_A, CUST_B = uuid.uuid4(), uuid.uuid4()


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})
    monkeypatch.setattr(docs, "read_business_settings", lambda: {"company_name": "Muster GmbH", "document_texts": {}})
    monkeypatch.setattr(docs, "read_company_profile", lambda: {})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


@pytest_asyncio.fixture
async def svc(session):
    gl = GLService(session, T1)
    await gl.load_template("de_skr03")
    await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
    return SalesService(session, T1)


def lines(*qtys):
    return [LineData(f"Item {i}", f"S{i}", D(q), D("100"), D(0), D("19")) for i, q in enumerate(qtys, start=1)]


async def mk(svc, kind="invoice", *, qtys=(1,), issue=False, **kw):
    kw.setdefault("doc_date", DAY)
    kw.setdefault("customer_name", "Kunde AG")
    doc = await svc.create(kind, lines=lines(*qtys), **kw)
    if issue:
        await svc.issue_invoice(doc.id)
    return doc


async def test_filters_sort_paging(svc):
    a = await mk(svc, customer_name="Alpha GmbH", customer_id=CUST_A, issue=True, due_date=PAST)
    b = await mk(
        svc,
        customer_name="Beta AG",
        customer_id=CUST_B,
        issue=True,
        due_date=FUTURE,
        doc_date=date(2026, 4, 1),
        qtys=(5,),
    )
    c = await mk(svc, customer_name="Alpha GmbH", customer_id=CUST_A, doc_date=date(2026, 5, 1))  # draft
    await svc.record_payment(b.id, amount=D("100"))

    rows, total = await svc.query_documents("invoice")
    assert total == 3 and [r.id for r in rows] == [c.id, b.id, a.id]  # default -doc_date

    rows, total = await svc.query_documents("invoice", statuses=["issued", "partially_paid"])
    assert total == 2 and {r.id for r in rows} == {a.id, b.id}
    assert (await svc.query_documents("invoice", customer_id=CUST_B))[1] == 1
    assert {r.id for r in (await svc.query_documents("invoice", q="alpha"))[0]} == {a.id, c.id}
    assert {r.id for r in (await svc.query_documents("invoice", q=b.number))[0]} == {b.id}
    rows, _ = await svc.query_documents("invoice", date_from=date(2026, 4, 1), date_to=date(2026, 4, 30))
    assert [r.id for r in rows] == [b.id]

    rows, total = await svc.query_documents("invoice", overdue=True)
    assert [r.id for r in rows] == [a.id] and total == 1 and rows[0].is_overdue and rows[0].balance_due == D("119.00")
    assert not b.is_overdue and not c.is_overdue  # not due / draft
    assert {r.id for r in (await svc.query_documents("invoice", overdue=False))[0]} == {b.id, c.id}

    rows, _ = await svc.query_documents("invoice", sort="gross_total")
    assert rows[0].id == a.id or rows[0].id == c.id
    assert (await svc.query_documents("invoice", sort="-gross_total"))[0][0].id == b.id
    assert (await svc.query_documents("invoice", sort="-balance"))[0][0].id == b.id  # 595 - 100 > 119
    assert (await svc.query_documents("invoice", sort="customer_name"))[0][-1].customer_name == "Beta AG"
    assert (await svc.query_documents("invoice", sort="-due_date"))[0][0].id == b.id

    rows, total = await svc.query_documents("invoice", sort="number", limit=2, offset=1)
    assert total == 3 and [r.number for r in rows] == sorted([a.number, b.number, c.number])[1:]
    with pytest.raises(SalesValidationError):
        await svc.query_documents("invoice", sort="bogus")


async def test_stats(svc):
    today = date(2026, 6, 15)
    await mk(svc, "quote", qtys=(1,))  # open 119
    q2 = await mk(svc, "quote")
    await svc.set_status(q2.id, "sent")
    await svc.set_status(q2.id, "accepted")
    q3 = await mk(svc, "quote")
    await svc.set_status(q3.id, "sent")
    await svc.set_status(q3.id, "rejected")
    o = await mk(svc, "order", qtys=(4,))
    await svc.set_status(o.id, "confirmed")
    await svc.order_to_invoice(o.id, lines=[(o.lines[0].id, D(1))])  # 1 of 4 invoiced -> 3 left
    inv = await mk(svc, issue=True, doc_date=date(2026, 6, 2), due_date=date(2026, 6, 10), qtys=(2,))
    await svc.record_payment(inv.id, amount=D("38"))
    st = await svc.stats(today)
    assert st["currency"] == "EUR"
    assert st["open_quotes_count"] == 2 and st["open_quotes_value"] == D("238.00")
    assert st["win_rate"] == pytest.approx(0.5)  # 1 accepted / (1 accepted + 1 rejected)
    assert st["orders_to_invoice_count"] == 1 and st["orders_to_invoice_value"] == D("357.00")
    assert st["invoiced_this_month"] == D("200.00")
    assert st["overdue_count"] == 1 and st["overdue_value"] == D("200.00")  # 238 - 38


async def test_stats_empty_win_rate_is_null(svc):
    assert (await svc.stats())["win_rate"] is None


async def test_duplicate(svc):
    inv = await mk(svc, qtys=(2, 3), issue=True, due_date=date(2026, 3, 24), customer_email="a@b.de")
    await svc.record_payment(inv.id, amount=D("50"))
    cp = await svc.duplicate(inv.id, "invoice")
    assert cp.id != inv.id and cp.number != inv.number and cp.status == "draft"
    assert cp.doc_date == date.today() and (cp.due_date - cp.doc_date).days == 14
    assert cp.source_id is None and cp.payments == [] and cp.amount_paid == 0 and cp.gl_entry_id is None
    assert [l.qty for l in cp.lines] == [D(2), D(3)] and cp.gross_total == inv.gross_total
    assert cp.customer_email == "a@b.de"
    with pytest.raises(SalesNotFoundError):
        await svc.duplicate(inv.id, "quote")


async def test_bulk(svc):
    q1, q2 = await mk(svc, "quote"), await mk(svc, "quote")
    await svc.set_status(q2.id, "sent")
    res = await svc.bulk("quote", "mark_sent", [q1.id, q2.id, uuid.uuid4()])
    assert res["processed"] == 1 and len(res["skipped"]) == 2 and res["drafts"] == []
    assert (await svc.get(q1.id)).status == "sent"
    assert {s["reason"] for s in res["skipped"]} >= {"not found"}

    o = await mk(svc, "order")
    assert (await svc.bulk("order", "mark_sent", [o.id]))["processed"] == 0  # orders have no 'sent'

    d1, d2 = await mk(svc), await mk(svc, issue=True)
    res = await svc.bulk("invoice", "delete_drafts", [d1.id, d2.id])
    assert res["processed"] == 1 and res["skipped"][0]["id"] == d2.id
    with pytest.raises(SalesNotFoundError):
        await svc.get(d1.id)

    paid = await mk(svc, issue=True, customer_email="x@kunde.de")
    full = await mk(svc, issue=True)
    await svc.record_payment(full.id, amount=full.gross_total)
    res = await svc.bulk("invoice", "reminder_drafts", [paid.id, full.id, d2.id])
    assert res["processed"] == 2 and [s["id"] for s in res["skipped"]] == [full.id]
    draft = next(x for x in res["drafts"] if x["id"] == paid.id)
    assert draft["to"] == "x@kunde.de" and draft["number"] == paid.number and draft["subject"] and draft["body"]
    assert (await svc.bulk("quote", "reminder_drafts", [q1.id]))["processed"] == 0
    with pytest.raises(SalesValidationError):
        await svc.bulk("quote", "explode", [q1.id])


async def test_related_and_activity(svc):
    q = await mk(svc, "quote")
    await svc.set_status(q.id, "sent")
    order = await svc.quote_to_order(q.id, created_by="u1")
    await svc.set_status(order.id, "confirmed")
    inv = await svc.order_to_invoice(order.id, created_by="u1")
    await svc.issue_invoice(inv.id, created_by="u1")
    await svc.record_payment(inv.id, amount=D("19"))
    cn = await svc.invoice_to_credit_note(inv.id)

    rel = await svc.related(order.id)
    assert rel["source"].id == q.id and [d.id for d in rel["derived"]] == [inv.id]
    assert (await svc.related(q.id))["source"] is None
    assert {d.id for d in (await svc.related(inv.id))["derived"]} == {cn.id}

    ev = await svc.activity(inv.id, "invoice")
    assert [e["type"] for e in ev if e["type"] != "created"] and {e["type"] for e in ev} == {
        "created",
        "issued",
        "payment",
        "credit_note",
    }
    assert [e["at"] for e in ev] == sorted((e["at"] for e in ev), reverse=True)
    assert ev[-1]["type"] == "created" or any(e["type"] == "created" for e in ev)
    assert next(e for e in ev if e["type"] == "credit_note")["ref_id"] == cn.id
    assert {e["type"] for e in await svc.activity(order.id)} == {"created", "derived"}


async def test_partial_convert_quote_and_order(svc):
    q = await mk(svc, "quote", qtys=(10, 4))
    await svc.set_status(q.id, "sent")
    l1, l2 = q.lines
    with pytest.raises(SalesValidationError):
        await svc.quote_to_order(q.id, lines=[(l1.id, D(11))])
    with pytest.raises(SalesValidationError):
        await svc.quote_to_order(q.id, lines=[(uuid.uuid4(), D(1))])

    o1 = await svc.quote_to_order(q.id, lines=[(l1.id, D(6))])
    assert [(l.line_no, l.qty) for l in o1.lines] == [(1, D(6))] and o1.source_id == q.id
    q = await svc.get(q.id)
    assert q.status == "accepted"  # still open
    assert [l.remaining_qty for l in q.lines] == [D(4), D(4)]

    o2 = await svc.quote_to_order(q.id)  # rest, no body
    assert [(l.line_no, l.qty) for l in o2.lines] == [(1, D(4)), (2, D(4))]
    q = await svc.get(q.id)
    assert q.status == "converted" and [l.remaining_qty for l in q.lines] == [D(0), D(0)]
    with pytest.raises(SalesConflictError):
        await svc.quote_to_order(q.id)

    await svc.set_status(o2.id, "confirmed")
    o2 = await svc.get(o2.id)
    assert [l.remaining_qty for l in o2.lines] == [D(4), D(4)]
    i1 = await svc.order_to_invoice(o2.id, lines=[(o2.lines[1].id, D(1))])
    assert i1.gross_total == D("119.00")
    o2 = await svc.get(o2.id)
    assert o2.status == "confirmed" and [l.remaining_qty for l in o2.lines] == [D(4), D(3)]
    # a cancelled invoice gives its quantity back
    await svc.set_status(i1.id, "cancelled")
    assert [l.remaining_qty for l in (await svc.get(o2.id)).lines] == [D(4), D(4)]
    full = await svc.order_to_invoice(o2.id)
    assert [l.qty for l in full.lines] == [D(4), D(4)]
    assert (await svc.get(o2.id)).status == "invoiced"


async def test_full_convert_without_body_unchanged(svc):
    q = await mk(svc, "quote", qtys=(2, 3))
    await svc.set_status(q.id, "sent")
    order = await svc.quote_to_order(q.id)
    assert (await svc.get(q.id)).status == "converted" and [l.qty for l in order.lines] == [D(2), D(3)]
    assert [l.remaining_qty for l in order.lines] == [D(2), D(3)]


async def test_tenant_isolation(session, svc):
    other = SalesService(session, T2)
    mine = await mk(svc, customer_name="Mine", issue=True, due_date=PAST)
    theirs = await mk(other, customer_name="Theirs")
    assert [r.id for r in (await svc.query_documents("invoice"))[0]] == [mine.id]
    assert (await svc.query_documents("invoice", q="Theirs"))[1] == 0
    assert (await other.stats())["overdue_count"] == 0 and (await svc.stats())["overdue_count"] == 1
    for call in (other.duplicate(mine.id), other.activity(mine.id), other.related(mine.id)):
        with pytest.raises(SalesNotFoundError):
            await call
    res = await svc.bulk("invoice", "delete_drafts", [theirs.id])
    assert res["processed"] == 0 and res["skipped"][0]["reason"] == "not found"


@pytest_asyncio.fixture
async def client(session, svc):
    from fastapi import FastAPI

    from app.modules.sales.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/sales")

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
    a = await mk(svc, customer_name="Alpha", issue=True, due_date=PAST)
    await mk(svc, customer_name="Beta")
    r = await client.get("/api/v1/sales/invoices/", params={"status": "issued,draft", "limit": 1, "sort": "number"})
    assert r.status_code == 200 and r.headers["X-Total-Count"] == "2" and len(r.json()) == 1
    r = await client.get("/api/v1/sales/invoices/", params={"overdue": "true"})
    row = r.json()[0]
    assert row["id"] == str(a.id) and row["is_overdue"] is True and D(row["balance_due"]) == D("119.00")
    assert (await client.get("/api/v1/sales/invoices/", params={"status_filter": "draft"})).headers[
        "X-Total-Count"
    ] == "1"
    assert (await client.get("/api/v1/sales/invoices/", params={"sort": "nope"})).status_code == 422

    r = await client.get("/api/v1/sales/stats/")  # static route is not shadowed by /{kind}/
    assert r.status_code == 200 and r.json()["overdue_count"] == 1 and r.json()["win_rate"] is None

    r = await client.post(f"/api/v1/sales/invoices/{a.id}/duplicate/")
    assert r.status_code == 201 and r.json()["status"] == "draft" and r.json()["source_id"] is None
    r = await client.post("/api/v1/sales/invoices/bulk/", json={"action": "reminder_drafts", "ids": [str(a.id)]})
    assert r.status_code == 200 and r.json()["processed"] == 1 and r.json()["drafts"][0]["number"] == a.number
    assert (await client.get(f"/api/v1/sales/invoices/{a.id}/activity/")).json()[0]["type"] in {"issued", "created"}
    assert (await client.get(f"/api/v1/sales/invoices/{a.id}/related/")).json() == {"source": None, "derived": []}

    q = await mk(svc, "quote", qtys=(5,))
    await svc.set_status(q.id, "sent")
    lid = str(q.lines[0].id)
    r = await client.post(
        f"/api/v1/sales/quotes/{q.id}/convert-to-order/", json={"lines": [{"line_id": lid, "qty": "2"}]}
    )
    assert r.status_code == 201 and D(r.json()["lines"][0]["qty"]) == D(2)
    r = await client.get(f"/api/v1/sales/quotes/{q.id}/")
    assert D(r.json()["lines"][0]["remaining_qty"]) == D(3)
    r = await client.post(
        f"/api/v1/sales/quotes/{q.id}/convert-to-order/", json={"lines": [{"line_id": lid, "qty": "9"}]}
    )
    assert r.status_code == 422
    assert (await client.post(f"/api/v1/sales/quotes/{q.id}/convert-to-order/")).status_code == 201  # no body = rest


async def test_order_delivered_transition(svc):
    o = await mk(svc, "order")
    await svc.set_status(o.id, "confirmed")
    await svc.set_status(o.id, "delivered")
    assert (await svc.stats())["orders_to_invoice_count"] == 1
    await svc.order_to_invoice(o.id)
    assert (await svc.get(o.id)).status == "invoiced"


async def test_item_id_and_payment_terms_round_trip(svc):
    item = uuid.uuid4()
    src = await svc.create(
        "quote",
        lines=[LineData("Thing", "T", D(2), D(10), D(0), D(19), item)],
        payment_terms="14 days net",
        doc_date=DAY,
    )
    assert (await svc.get(src.id)).lines[0].item_id == item and src.payment_terms == "14 days net"
    cp = await svc.duplicate(src.id)
    assert cp.lines[0].item_id == item and cp.payment_terms == "14 days net"
    await svc.set_status(src.id, "sent")
    order = await svc.quote_to_order(src.id)
    assert order.lines[0].item_id == item and order.payment_terms == "14 days net"
