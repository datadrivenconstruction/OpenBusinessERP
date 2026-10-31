"""EUR company, USD sales invoice and USD supplier bill: document rate, realized FX, aging, bank, reports."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.banking.service import AllocationIn, BankingService
from app.modules.gl import service as gl_service
from app.modules.gl.fx_posting import q_rate, resolve_doc_rate
from app.modules.gl.service import GLService, LineInput, build_lines
from app.modules.purchasing.service import LineData as PLine
from app.modules.purchasing.service import PurchasingService
from app.modules.receivables.service import ReceivablesService
from app.modules.sales.service import LineData, SalesService
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 3, 1)
PAY = date(2026, 3, 20)
NL = chr(10)


@pytest.fixture(autouse=True)
def _base_eur(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


async def _setup(session):
    gl = GLService(session, "default")
    await gl.load_template("de_skr03")
    await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
    return gl


async def _bal(gl):
    tb = await gl.trial_balance(None, None)
    assert tb["balanced"], tb
    return {r["code"]: r["closing"] for r in tb["rows"]}


async def _usd_invoice(sales, rate="0.92"):
    inv = await sales.create(
        "invoice",
        lines=[LineData("Consulting", "", D(1), D("1000.00"), D(0), D(19))],
        doc_date=DAY,
        due_date=date(2026, 3, 15),
        customer_name="US Client Inc",
        currency="usd",
        fx_rate=D(rate),
    )
    return await sales.issue_invoice(inv.id)


async def test_usd_invoice_posts_in_base_and_payment_books_realized_gain(session):
    gl = await _setup(session)
    sales = SalesService(session, "default")
    inv = await _usd_invoice(sales)
    assert (inv.currency, inv.gross_total, inv.fx_rate) == ("USD", D("1190.00"), D("0.92"))
    bal = await _bal(gl)
    # 1190 USD * 0.92 = 1094.80 EUR; 920.00 revenue + 174.80 VAT
    assert (bal["1400"], bal["8400"], bal["1776"]) == (D("1094.80"), D("-920.00"), D("-174.80"))

    aging = await ReceivablesService(session, "default").aging(as_of=date(2026, 3, 31))
    row = aging["rows"][0]["invoices"][0]
    assert (row["open"], row["currency"], row["open_base"]) == (D("1190.00"), "USD", D("1094.80"))
    assert aging["totals"]["total"] == D("1094.80") and aging["base_currency"] == "EUR"

    # Partial 500 USD at 0.95, rest 690 USD at 0.90
    await sales.record_payment(inv.id, amount=D("500.00"), pay_date=PAY, fx_rate=D("0.95"))
    bal = await _bal(gl)
    assert (bal["1200"], bal["1400"], bal["2660"]) == (D("475.00"), D("634.80"), D("-15.00"))
    await sales.record_payment(inv.id, amount=D("690.00"), pay_date=PAY, fx_rate=D("0.90"))
    bal = await _bal(gl)
    # 690 * 0.90 = 621.00 cash vs 634.80 open -> 13.80 loss
    assert (bal["1200"], bal["1400"], bal["2660"], bal["2150"]) == (D("1096.00"), D("0"), D("-15.00"), D("13.80"))
    assert inv.status == "paid"

    pl = await gl.profit_and_loss(None, None)
    assert pl["net_income"] == D("920.00") + D("15.00") - D("13.80")
    bs = await gl.balance_sheet(date(2026, 12, 31))
    assert bs["balanced"] and bs["base_currency"] == "EUR"


async def test_usd_bill_payment_books_realized_loss(session):
    gl = await _setup(session)
    purch = PurchasingService(session, "default")
    bill = await purch.create_bill(
        lines=[PLine("Licence", "", D(1), D("200.00"), D(19))],
        supplier_name="US Vendor LLC",
        doc_date=DAY,
        currency="USD",
        fx_rate=D("0.92"),
    )
    await purch.post_bill(bill.id)
    bal = await _bal(gl)
    # 238.00 USD * 0.92 = 218.96 EUR (184.00 expense + 34.96 input VAT)
    assert bal["1600"] == D("-218.96")  # closing is debit - credit
    await purch.record_payment(bill.id, amount=D("238.00"), pay_date=PAY, fx_rate=D("0.95"))
    bal = await _bal(gl)
    # 238 * 0.95 = 226.10 paid vs 218.96 booked -> 7.14 loss
    assert (bal["1600"], bal["1200"], bal["2150"]) == (D("0"), D("-226.10"), D("7.14"))


async def test_usd_payment_into_eur_bank_account(session):
    gl = await _setup(session)
    sales = SalesService(session, "default")
    bank = BankingService(session, "default")
    acc = await bank.create_account(name="Main EUR", iban="DE89 3704 0044 0532 0130 00")
    inv = await _usd_invoice(sales)
    await bank.import_statement(
        acc.id,
        "d;a;n;t" + NL + "2026-03-20;1130,50;US Client Inc;INV" + NL,
        fmt="csv",
        mapping={"date": "d", "amount": "a", "counterparty_name": "n", "remittance": "t"},
    )
    txn = (await bank.list_transactions(acc.id))[0]
    await bank.confirm(txn.id, [AllocationIn("sales_invoice", inv.id, D("1130.50"), D("1190.00"))])
    bal = await _bal(gl)
    # 1130.50 EUR received for 1094.80 EUR booked -> 35.70 gain
    assert (txn.status, inv.status) == ("matched", "paid")
    assert (bal["1200"], bal["1400"], bal["2660"]) == (D("1130.50"), D("0"), D("-35.70"))


async def test_rate_defaults_from_register_and_manual_override_wins(session):
    await _setup(session)
    sales = SalesService(session, "default")
    auto = await sales.create(
        "invoice", lines=[LineData("x", "", D(1), D(10), D(0), D(0))], doc_date=DAY, currency="GBP"
    )
    expected = await resolve_doc_rate(session, "GBP", DAY)
    assert auto.fx_rate == expected and auto.fx_rate != 1 and auto.fx_rate == q_rate(auto.fx_rate)
    eur = await sales.create("invoice", lines=[LineData("x", "", D(1), D(10), D(0), D(0))], doc_date=DAY)
    assert eur.fx_rate == 1
    manual = await sales.create(
        "invoice", lines=[LineData("x", "", D(1), D(10), D(0), D(0))], doc_date=DAY, currency="GBP", fx_rate=D("1.17")
    )
    assert manual.fx_rate == D("1.17")


def test_per_line_rounding_is_absorbed_on_largest_line():
    # 92.509 -> 92.51, 17.575 -> 17.58, 110.084 -> 110.08: one cent apart before absorption
    a, b, c = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
    lines = build_lines(
        [LineInput(a, debit=D("119.01")), LineInput(b, credit=D("100.01")), LineInput(c, credit=D("19.00"))],
        D("0.925"),
    )
    assert sum(ln.base_debit for ln in lines) == sum(ln.base_credit for ln in lines) == D("110.08")
    assert [ln.base_credit for ln in lines[1:]] == [D("92.50"), D("17.58")]
