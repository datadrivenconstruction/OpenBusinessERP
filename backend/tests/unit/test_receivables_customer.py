"""Receivables customer drill-down: payment behaviour, promises/notes, dunning preview, isolation."""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.banking.service import partner_key
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.receivables import service as rsvc
from app.modules.receivables.customer import CustomerAccountService, followup_out, payment_stats
from app.modules.receivables.service import (
    ReceivablesConflictError,
    ReceivablesNotFoundError,
    ReceivablesService,
    ReceivablesValidationError,
)
from app.modules.sales.service import LineData, SalesService
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 1, 5)
DUE = date(2026, 1, 15)
ACME = partner_key(None, "Acme")


@pytest.fixture(autouse=True)
def _settings(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})
    monkeypatch.setattr(rsvc, "read_business_settings", lambda: {"country_code": "GB"})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


async def _setup(session, tenant="default"):
    gl = GLService(session, tenant)
    await gl.load_template("de_skr03")
    await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
    return SalesService(session, tenant), CustomerAccountService(session, tenant)


async def _invoice(sales, name, net, due=DUE):
    inv = await sales.create(
        "invoice",
        lines=[LineData("Work", "", D(1), D(net), D(0), D(0))],
        doc_date=DAY,
        due_date=due,
        customer_name=name,
    )
    return await sales.issue_invoice(inv.id)


def test_payment_stats_weighted_by_amount():
    pays = [
        {"amount": D("100"), "days_to_pay": 10, "days_late": 0},
        {"amount": D("300"), "days_to_pay": 30, "days_late": 20},
    ]
    s = payment_stats(pays)
    assert (s["avg_days_to_pay"], s["avg_days_late"], s["on_time_share"]) == (25.0, 15.0, 25)
    assert payment_stats([])["avg_days_to_pay"] is None


async def test_customer_detail_payments_promises_and_preview(session):
    sales, cust = await _setup(session)
    paid = await _invoice(sales, "Acme", "100")
    await sales.record_payment(paid.id, amount=paid.gross_total, pay_date=DUE + timedelta(days=5))
    open_inv = await _invoice(sales, "Acme", "200")
    await _invoice(sales, "Beta", "50")
    as_of = DUE + timedelta(days=10)

    detail = await cust.detail(ACME, as_of)
    assert detail["customer_name"] == "Acme" and [i["number"] for i in detail["invoices"]] == [open_inv.number]
    (pay,) = detail["payments"]
    assert (pay["days_to_pay"], pay["days_late"]) == (15, 5)
    assert detail["stats"]["avg_days_to_pay"] == 15.0 and detail["stats"]["on_time_share"] == 0
    # Preview shows the level-1 draft but stores nothing.
    assert [p["level"] for p in detail["next_dunning"]] == [1]
    assert await ReceivablesService(session).list_runs() == []

    promise = await cust.add(
        {
            "partner_key": ACME,
            "customer_name": "Acme",
            "kind": "promise",
            "invoice_id": open_inv.id,
            "promised_date": as_of - timedelta(days=1),
            "promised_amount": D("200"),
            "text": "Phoned, pays Friday",
        }
    )
    await cust.add({"partner_key": ACME, "kind": "note", "text": "Prefers email"})
    assert promise.invoice_number == open_inv.number and promise.status == "open"
    assert followup_out(promise, as_of)["overdue"] is True
    detail = await cust.detail(ACME, as_of)
    assert detail["promised_open"] == D("200.00") and len(detail["followups"]) == 2
    await cust.set_status(promise.id, "kept")
    assert await cust.promises() == []

    note = next(f for f in await cust.followups(ACME) if f.kind == "note")
    with pytest.raises(ReceivablesConflictError):
        await cust.set_status(note.id, "kept")
    with pytest.raises(ReceivablesValidationError):
        await cust.add({"partner_key": ACME, "kind": "promise", "promised_amount": D("5")})
    with pytest.raises(ReceivablesValidationError):
        await cust.add({"partner_key": ACME, "kind": "note", "text": "  "})
    await cust.delete(note.id)
    assert len(await cust.followups(ACME)) == 1


async def test_customer_isolation(session):
    sales, cust = await _setup(session)
    await _invoice(sales, "Acme", "100")
    row = await cust.add({"partner_key": ACME, "kind": "note", "text": "x"})
    other = CustomerAccountService(session, "tenant-b")
    with pytest.raises(ReceivablesNotFoundError):
        await other.detail(ACME, DUE)
    with pytest.raises(ReceivablesNotFoundError):
        await other.delete(row.id)
    assert await other.followups(ACME) == []
