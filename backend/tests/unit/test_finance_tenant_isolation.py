"""GL + sales tenant isolation: tenant B cannot see or touch tenant A's books."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException

from app.modules.gl import service as gl_service
from app.modules.gl.router import _call as gl_call
from app.modules.gl.service import GLNotFoundError, GLService, GLValidationError, LineInput
from app.modules.sales.router import _call as sales_call
from app.modules.sales.service import LineData, SalesNotFoundError, SalesService
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 3, 10)
A, B = "tenant-a", "tenant-b"


@pytest.fixture(autouse=True)
def _base_eur(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        for t in (A, B):  # same codes / fiscal-year names in both tenants must not collide
            gl = GLService(s, t)
            await gl.load_template("de_skr03")
            await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
        yield s


LINES = [LineData("Consulting", "SVC-1", D("2"), D("100"), D("0"), D("19"))]


@pytest.mark.asyncio
async def test_sales_documents_invisible_and_unmodifiable_across_tenants(session):
    sa, sb = SalesService(session, A), SalesService(session, B)
    q = await sa.create("quote", lines=LINES, doc_date=DAY)
    assert await sb.list_documents("quote") == []
    for aw in (sb.get(q.id), sb.update(q.id, notes="x"), sb.delete(q.id), sb.set_status(q.id, "sent"),
               sb.quote_to_order(q.id)):
        with pytest.raises(HTTPException) as exc:
            await sales_call(aw)
        assert exc.value.status_code == 404
    assert (await sa.get(q.id)).notes == ""


@pytest.mark.asyncio
async def test_numbering_independent_per_tenant(session):
    sa, sb = SalesService(session, A), SalesService(session, B)
    a1 = await sa.create("quote", lines=LINES, doc_date=DAY)
    a2 = await sa.create("quote", lines=LINES, doc_date=DAY)
    b1 = await sb.create("quote", lines=LINES, doc_date=DAY)
    assert (a1.number, a2.number, b1.number) == ("QT-000001", "QT-000002", "QT-000001")
    await sa.set_status(a1.id, "sent")
    order = await sa.quote_to_order(a1.id)
    inv = await sa.order_to_invoice((await sa.set_status(order.id, "confirmed")).id)
    await sa.issue_invoice(inv.id)
    assert (order.number, inv.number) == ("SO-000001", "INV-000001")
    b_inv = await sb.create("invoice", lines=LINES, doc_date=DAY)
    await sb.issue_invoice(b_inv.id)
    assert b_inv.number == "INV-000001"
    # GL entry numbering per tenant fiscal year as well
    ea = await GLService(session, A).get_entry(inv.gl_entry_id)
    eb = await GLService(session, B).get_entry(b_inv.gl_entry_id)
    assert ea.number == eb.number == "FY2026-000001"


@pytest.mark.asyncio
async def test_gl_entries_reports_and_summary_scoped(session):
    ga, gb = GLService(session, A), GLService(session, B)
    acc_a = {a.code: a.id for a in await ga.list_accounts()}
    acc_b = {a.code: a.id for a in await gb.list_accounts()}
    assert set(acc_a) == set(acc_b) and not set(acc_a.values()) & set(acc_b.values())
    e = await ga.create_entry(entry_date=DAY, post=True, lines=[
        LineInput(acc_a["1200"], debit=D("500")), LineInput(acc_a["8400"], credit=D("500"))])
    for aw in (gb.get_entry(e.id), gb.reverse_entry(e.id), gb.delete_draft(e.id), gb.get_account(acc_a["1200"])):
        with pytest.raises(HTTPException) as exc:
            await gl_call(aw)
        assert exc.value.status_code == 404
    with pytest.raises(GLValidationError):  # A's account ids are unknown to B
        await gb.create_entry(entry_date=DAY, lines=[
            LineInput(acc_a["1200"], debit=D("1")), LineInput(acc_a["8400"], credit=D("1"))])
    assert await gb.list_entries() == []
    assert (await gb.trial_balance(None, None))["rows"] == []
    assert (await ga.trial_balance(None, None))["total_debit"] == D("500.00")
    assert (await gb.profit_and_loss(None, None))["net_income"] == 0
    period_a = (await ga.list_fiscal_years())[0].periods[0]
    with pytest.raises(GLNotFoundError):
        await gb.set_period_status(period_a.id, "closed")
    await SalesService(session, A).create("quote", lines=LINES, doc_date=DAY)
    sb = await SalesService(session, B).summary(today=DAY)
    assert sb["open_quotes_value"] == 0 and sb["receivables"] == 0
    assert (await SalesService(session, A).summary(today=DAY))["open_quotes_value"] == D("238.00")
    with pytest.raises(SalesNotFoundError):
        await SalesService(session, B).get(e.id)
