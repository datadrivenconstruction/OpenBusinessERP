"""Sales: totals/rounding, transitions, conversion, GL posting, payments."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.modules.gl import service as gl_service
from app.modules.gl.models import GLJournalEntry
from app.modules.gl.service import GLService
from app.modules.sales.service import (
    LineData,
    SalesConflictError,
    SalesService,
    check_transition,
    line_amounts,
)
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 3, 10)


@pytest.fixture(autouse=True)
def _base_eur(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


@pytest_asyncio.fixture
async def svc(session):
    gl = GLService(session)
    await gl.load_template("de_skr03")
    await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
    return SalesService(session)


LINES = [
    LineData("Consulting", "SVC-1", D("3"), D("33.333"), D("10"), D("19")),
    LineData("Widget", "W-2", D("2.5"), D("19.99"), D("0"), D("7")),
]


def test_line_rounding_half_up():
    # 3 * 33.333 * 0.9 = 89.9991 -> 90.00; tax 17.10
    assert line_amounts(D(3), D("33.333"), D(10), D(19)) == (D("90.00"), D("17.10"), D("107.10"))
    # 0.005 tax rounds half-up
    assert line_amounts(D(1), D("0.05"), D(0), D(10)) == (D("0.05"), D("0.01"), D("0.06"))


def test_transitions():
    check_transition("quote", "draft", "sent")
    check_transition("invoice", "issued", "paid")
    for kind, cur, tgt in (
        ("quote", "draft", "accepted"),
        ("order", "invoiced", "draft"),
        ("invoice", "paid", "cancelled"),
    ):
        with pytest.raises(SalesConflictError):
            check_transition(kind, cur, tgt)


async def test_totals_and_numbering(svc):
    q1 = await svc.create("quote", lines=LINES, doc_date=DAY, customer_name="ACME")
    q2 = await svc.create("quote", lines=[], doc_date=DAY)
    assert (q1.number, q2.number) == ("QT-000001", "QT-000002")
    # widget: 49.975 -> 49.98 net, 3.50 tax
    assert q1.net_total == D("139.98") and q1.tax_total == D("20.60") and q1.gross_total == D("160.58")


async def test_conversion_chain(svc):
    q = await svc.create("quote", lines=LINES, doc_date=DAY, customer_name="ACME")
    with pytest.raises(SalesConflictError):
        await svc.quote_to_order(q.id)  # draft cannot convert
    await svc.set_status(q.id, "sent")
    so = await svc.quote_to_order(q.id)
    assert q.status == "converted" and so.number.startswith("SO-") and so.source_id == q.id
    assert so.gross_total == q.gross_total and len(so.lines) == 2
    with pytest.raises(SalesConflictError):
        await svc.order_to_invoice(so.id)  # must be confirmed
    await svc.set_status(so.id, "confirmed")
    inv = await svc.order_to_invoice(so.id)
    assert so.status == "invoiced" and inv.number.startswith("INV-") and inv.status == "draft"


async def _issued(svc):
    inv = await svc.create("invoice", lines=LINES, doc_date=DAY, customer_name="ACME")
    return await svc.issue_invoice(inv.id)


async def test_issue_posts_balanced_entry(svc, session):
    inv = await _issued(svc)
    entry = await session.get(GLJournalEntry, inv.gl_entry_id)
    assert entry.status == "posted" and entry.source_type == "sales_invoice" and entry.source_id == str(inv.id)
    assert sum(ln.debit for ln in entry.lines) == sum(ln.credit for ln in entry.lines) == inv.gross_total
    with pytest.raises(SalesConflictError):
        await svc.update(inv.id, notes="x")


async def test_payment_closes_invoice(svc, session):
    inv = await _issued(svc)
    await svc.record_payment(inv.id, amount=D("60.58"), pay_date=DAY)
    assert inv.status == "partially_paid"
    await svc.record_payment(inv.id, amount=D("100.00"), pay_date=DAY)
    assert inv.status == "paid" and inv.amount_paid == inv.gross_total
    pays = (
        (await session.execute(select(GLJournalEntry).where(GLJournalEntry.source_type == "sales_payment")))
        .scalars()
        .all()
    )
    assert len(pays) == 2 and all(e.status == "posted" for e in pays)
    with pytest.raises(SalesConflictError):
        await svc.record_payment(inv.id, amount=D("1"))


async def test_missing_accounts_conflict(session, svc):
    await svc.set_account_mapping({"vat": "9999"})
    inv = await svc.create("invoice", lines=LINES, doc_date=DAY)
    with pytest.raises(SalesConflictError, match="vat"):
        await svc.issue_invoice(inv.id)
    assert inv.status == "draft"


def test_omitted_tax_rate_uses_company_country(monkeypatch):
    from app.modules.sales import service as sales_service
    from app.modules.sales.service import build_lines, default_tax_rate

    monkeypatch.setattr(sales_service, "read_business_settings", lambda: {"country_code": "AT"})
    [ln, explicit] = build_lines(
        [LineData("A", "", D(1), D(100), D(0), None), LineData("B", "", D(1), D(100), D(0), D(0))]
    )
    assert (ln.tax_rate, ln.tax) == (D(20), D("20.00"))
    assert explicit.tax == 0
    assert default_tax_rate("US") == 0 and default_tax_rate("") == 0 and default_tax_rate("de") == 19


async def test_summary_kpis(svc):
    inv = await _issued(svc)
    await svc.record_payment(inv.id, amount=D("60.58"), pay_date=DAY)
    await svc.create("quote", lines=LINES, doc_date=DAY)
    s = await svc.summary(today=date(2026, 4, 5))
    assert s["currency"] == "EUR"
    assert s["receivables"] == inv.gross_total - D("60.58")
    assert s["open_quotes_value"] > 0 and s["open_orders_value"] == 0
    assert s["payables"] == 0 and len(s["revenue_by_month"]) == 6
    assert {m["month"]: m["revenue"] for m in s["revenue_by_month"]}["2026-03"] == inv.net_total


async def test_summary_window_and_month_leaders(svc):
    inv = await _issued(svc)
    s = await svc.summary(today=date(2026, 3, 20), months_back=12)
    assert len(s["revenue_by_month"]) == 12 and s["revenue_by_month"][-1]["month"] == "2026-03"
    [top] = s["top_customers"]
    assert top["revenue"] == inv.net_total and top["invoices"] == 1
    assert s["top_items"] and s["top_items"][0]["revenue"] <= inv.net_total
    later = await svc.summary(today=date(2026, 5, 2))
    assert later["top_customers"] == [] and later["top_items"] == []


async def _closing_by_code(svc):
    tb = await svc.gl.trial_balance(None, None)
    return {r["code"]: r["closing"] for r in tb["rows"]}


async def test_credit_note_posts_proportional_reversal(svc):
    from app.modules.sales.service import SalesValidationError

    inv = await svc.create("invoice", lines=LINES, doc_date=DAY, customer_name="ACME")
    await svc.issue_invoice(inv.id)
    cn = await svc.invoice_to_credit_note(inv.id)
    await svc.update(cn.id, lines=[LINES[0]])  # credit only the consulting line
    await svc.set_status(cn.id, "issued")
    assert cn.status == "issued" and cn.gl_entry_id and cn.gross_total == D("107.10")
    tb = await _closing_by_code(svc)
    assert sum(tb.values()) == 0
    assert tb["1400"] == inv.gross_total - cn.gross_total
    assert tb["8400"] == -(inv.net_total - cn.net_total)
    assert tb["1776"] + tb.get("1771", 0) == -(inv.tax_total - cn.tax_total)
    assert inv.status == "partially_paid" and inv.gross_total - inv.amount_paid == D("53.48")
    # Remaining open amount can be credited, but not more.
    cn2 = await svc.invoice_to_credit_note(inv.id)
    with pytest.raises(SalesValidationError):
        await svc.set_status(cn2.id, "issued")
    await svc.update(cn2.id, lines=[LINES[1]])
    await svc.set_status(cn2.id, "issued")
    assert inv.status == "paid"
    tb = await _closing_by_code(svc)
    assert sum(tb.values()) == 0 and tb["1400"] == 0 and tb["8400"] == 0
