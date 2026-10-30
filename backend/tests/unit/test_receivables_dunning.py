"""Receivables: aging buckets, dunning level progression, block list, drafts never sent, isolation."""

from __future__ import annotations

import inspect
from datetime import date, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.banking.service import partner_key
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.receivables import service as rsvc
from app.modules.receivables.service import ReceivablesConflictError, ReceivablesService, bucket_for, render
from app.modules.sales.service import LineData, SalesService
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 1, 5)
DUE = date(2026, 1, 15)


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
    return SalesService(session, tenant), ReceivablesService(session, tenant)


async def _invoice(sales, name, net, due=DUE):
    inv = await sales.create(
        "invoice",
        lines=[LineData("Work", "", D(1), D(net), D(0), D(0))],
        doc_date=DAY,
        due_date=due,
        customer_name=name,
    )
    return await sales.issue_invoice(inv.id)


def test_buckets_and_render():
    assert [bucket_for(d) for d in (-3, 0, 1, 30, 31, 61, 91)] == [
        "current",
        "current",
        "d1_30",
        "d1_30",
        "d31_60",
        "d61_90",
        "d90_plus",
    ]
    assert render("Hi {customer}, {unknown}", {"customer": "Ann"}) == "Hi Ann, {unknown}"


async def test_aging_per_customer(session):
    sales, rec = await _setup(session)
    await _invoice(sales, "Acme", "100", due=date(2026, 3, 20))
    await _invoice(sales, "Acme", "50", due=date(2026, 2, 1))
    await _invoice(sales, "Beta", "70", due=date(2025, 11, 1))
    out = await rec.aging(date(2026, 3, 15))
    acme = next(r for r in out["rows"] if r["customer_name"] == "Acme")
    assert (acme["current"], acme["d31_60"], acme["total"]) == (D("100.00"), D("50.00"), D("150.00"))
    assert out["totals"]["d90_plus"] == D("70.00") and out["totals"]["total"] == D("220.00")
    pdf = await rec.statement_pdf(acme["partner_key"], date(2026, 3, 15))
    assert pdf.startswith(b"%PDF")


async def test_dunning_progression_and_never_sends(session):
    sales, rec = await _setup(session)
    inv = await _invoice(sales, "Acme", "100")
    # The module has no delivery path at all: no mail or notification imports.
    src = inspect.getsource(rsvc)
    assert not any(w in src for w in ("smtplib", "send_mail", "send_email", "notifications", "email_service"))

    levels = await rec.levels()
    assert [lv.level for lv in levels] == [1, 2, 3] and all(lv.fee == 0 for lv in levels)
    assert (await rec.propose_run(DUE + timedelta(days=3))).letters == []  # not yet due for level 1

    run1 = await rec.propose_run(DUE + timedelta(days=10))
    (l1,) = run1.letters
    assert (l1.level, l1.status, l1.fee, l1.interest) == (1, "draft", 0, 0)
    assert "INV-" in l1.subject and "Acme" in l1.body
    # Pending draft blocks a second proposal for the same invoice.
    assert (await rec.propose_run(DUE + timedelta(days=11))).letters == []
    await rec.decide(l1.id, "approved")
    assert l1.status == "approved" and not hasattr(l1, "sent_at")

    run2 = await rec.propose_run(DUE + timedelta(days=40))
    (l2,) = run2.letters
    assert l2.level == 2
    await rec.decide(l2.id, "discarded")
    run3 = await rec.propose_run(DUE + timedelta(days=41))
    assert run3.letters[0].level == 2  # discarded drafts do not advance the level
    await rec.decide(run3.letters[0].id, "approved")
    run4 = await rec.propose_run(DUE + timedelta(days=60))
    assert run4.letters[0].level == 3
    await rec.decide(run4.letters[0].id, "approved")
    assert (await rec.propose_run(DUE + timedelta(days=90))).letters == []  # no level above 3
    assert [h.level for h in await rec.history(partner_key(None, "Acme"))] == [3, 2, 1]
    with pytest.raises(ReceivablesConflictError):
        await rec.decide(l1.id, "discarded")
    assert inv.status == "issued"


async def test_fees_and_interest_off_by_default_then_configurable(session):
    sales, rec = await _setup(session)
    await _invoice(sales, "Acme", "1000")
    levels = [
        {
            "level": lv.level,
            "name": lv.name,
            "days_after_due": lv.days_after_due,
            "fee": D("5"),
            "subject": lv.subject,
            "body": lv.body,
        }
        for lv in await rec.levels()
    ]
    await rec.set_levels(levels)
    (letter,) = (await rec.propose_run(DUE + timedelta(days=10))).letters
    assert letter.fee == 0 and letter.interest == 0
    await rec.decide(letter.id, "discarded")
    await rec.update_settings(fees_enabled=True, interest_enabled=True, interest_rate_pct=D("7.3"))
    (letter,) = (await rec.propose_run(DUE + timedelta(days=10))).letters
    assert letter.fee == D("5.00") and letter.interest == D("2.00")  # 1000 * 7.3% * 10/365


async def test_block_list_and_isolation(session):
    sales, rec = await _setup(session)
    await _invoice(sales, "Acme", "100")
    await _invoice(sales, "Beta", "100")
    await rec.block(partner_key(None, "Acme"), "Acme", "in dispute")
    run = await rec.propose_run(DUE + timedelta(days=10))
    assert [lt.customer_name for lt in run.letters] == ["Beta"]
    other = ReceivablesService(session, "tenant-b")
    assert (await other.aging(DUE))["rows"] == []
    assert (await other.propose_run(DUE + timedelta(days=10))).letters == []
    assert await other.history() == []
    assert all(not r.letters for r in await other.list_runs())
