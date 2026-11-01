"""FX gaps: GRNI at differing PO/bill rates, period-end revaluation, payment rate, invoice-issued stock, USD bank."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.banking.service import BankingService
from app.modules.banking.workspace import BankingWorkspace
from app.modules.gl import fx_revaluation
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLConflictError, GLService
from app.modules.inventory.service import InventoryService
from app.modules.items.models import Item
from app.modules.purchasing.service import LineData as PLine
from app.modules.purchasing.service import PurchasingService
from app.modules.sales.service import LineData as SLine
from app.modules.sales.service import SalesService
from tests._pg import transactional_session

D = Decimal
T = "tenant-fx-close"
DAY = date(2026, 3, 1)
END = date(2026, 3, 31)
NL = chr(10)


@pytest.fixture(autouse=True)
def _base_eur(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        gl = GLService(s, T)
        await gl.load_template("de_skr03")
        await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
        yield s


async def _bal(session, on: date | None = None) -> dict[str, Decimal]:
    tb = await GLService(session, T).trial_balance(None, on)
    assert tb["balanced"], tb
    return {r["code"]: r["closing"] for r in tb["rows"]}


async def _item(session, sku="W-1"):
    it = Item(tenant_id=T, sku=sku, name="Widget", purchase_cost=D(10), stock_tracked=True)
    session.add(it)
    await session.flush()
    return it


async def test_grni_cleared_at_receipt_rate_and_rate_difference_to_fx(session):
    p = PurchasingService(session, T)
    m = await p.account_mapping()
    item = await _item(session)
    po = await p.create_order(
        supplier_name="US Vendor",
        doc_date=DAY,
        currency="USD",
        fx_rate=D("0.90"),
        lines=[PLine("Widget", item.sku, D(10), D(10), D(19), item.id)],
    )
    await p.set_order_status(po.id, "confirmed")
    await p.receive(po.id, None, doc_date=DAY)
    bal = await _bal(session)
    assert (bal[m["inventory"]], bal[m["grni"]]) == (D("90.00"), D("-90.00"))  # 100 USD x 0.90

    bill = await p.bill_from_order(po.id)
    await p.update_bill(bill.id, fx_rate=D("0.95"))
    await p.post_bill(bill.id)
    bal = await _bal(session)
    # GRNI 90.00 cleared at 0.90; payable 119 x 0.95 = 113.05; VAT 19 x 0.95 = 18.05; rate loss 5.00
    assert bal.get(m["grni"], D(0)) == D(0)
    assert (bal[m["payables"]], bal[m["input_vat"]], bal["2150"]) == (D("-113.05"), D("18.05"), D("5.00"))

    # Paying at the bill rate leaves no further FX difference.
    await p.record_payment(bill.id, amount=D("119.00"), pay_date=END, fx_rate=D("0.95"))
    bal = await _bal(session)
    assert bal.get(m["payables"], D(0)) == D(0) and bal["2150"] == D("5.00")


async def test_grni_same_rate_keeps_document_currency_posting(session):
    p = PurchasingService(session, T)
    m = await p.account_mapping()
    item = await _item(session)
    po = await p.create_order(
        supplier_name="US Vendor",
        doc_date=DAY,
        currency="USD",
        fx_rate=D("0.90"),
        lines=[PLine("Widget", item.sku, D(10), D(10), D(19), item.id)],
    )
    await p.set_order_status(po.id, "confirmed")
    await p.receive(po.id, None, doc_date=DAY)
    bill = await p.bill_from_order(po.id)
    await p.post_bill(bill.id)
    bal = await _bal(session)
    assert bal.get(m["grni"], D(0)) == D(0) and bal[m["payables"]] == D("-107.10") and "2150" not in bal


async def _usd_invoice_and_bill(session):
    sales = SalesService(session, T)
    inv = await sales.create(
        "invoice",
        lines=[SLine("Consulting", "", D(1), D("1000.00"), D(0), D(19))],
        doc_date=DAY,
        customer_name="US Client",
        currency="USD",
        fx_rate=D("0.92"),
    )
    inv = await sales.issue_invoice(inv.id)
    p = PurchasingService(session, T)
    bill = await p.create_bill(
        lines=[PLine("Licence", "", D(1), D("200.00"), D(19))],
        supplier_name="US Vendor",
        doc_date=DAY,
        currency="USD",
        fx_rate=D("0.92"),
    )
    bill = await p.post_bill(bill.id)
    return sales, inv, p, bill


async def test_period_end_revaluation_preview_post_and_reversal(session):
    sales, inv, p, bill = await _usd_invoice_and_bill(session)
    # A payment after the closing date does not reduce the item open on the closing date.
    await sales.record_payment(inv.id, amount=D("500.00"), pay_date=date(2026, 4, 10), fx_rate=D("0.95"))

    pv = await fx_revaluation.preview(session, T, END, {"USD": "0.95"})
    rows = {r["side"]: r for r in pv["rows"]}
    ar, ap = rows["receivable"], rows["payable"]
    # AR 1190 USD: 1094.80 -> 1130.50 (+35.70 gain); AP 238 USD: 218.96 -> 226.10 (7.14 loss)
    assert (ar["open"], ar["booked"], ar["revalued"], ar["gain"]) == (
        D("1190.00"),
        D("1094.80"),
        D("1130.50"),
        D("35.70"),
    )
    assert (ap["open"], ap["booked"], ap["revalued"], ap["gain"]) == (
        D("238.00"),
        D("218.96"),
        D("226.10"),
        D("-7.14"),
    )
    assert (pv["net_gain"], pv["posted"], pv["reversal_date"]) == (D("28.56"), False, date(2026, 4, 1))

    res = await fx_revaluation.post(session, T, END, {"USD": "0.95"})
    assert res["entry_id"] and res["reversal_id"]
    on_close = await _bal(session, END)
    assert (on_close["1400"], on_close["1600"], on_close["2660"]) == (D("1130.50"), D("-226.10"), D("-28.56"))
    after = await _bal(session)
    # Reversed on 1 April: AR back to document rate (less the April payment), revaluation gone.
    assert (after["1400"], after["1600"]) == (D("1094.80") - D("460.00"), D("-218.96"))
    assert after["2660"] == D("-15.00")  # only the realised gain of the April payment (500 x 0.03)
    with pytest.raises(GLConflictError):
        await fx_revaluation.post(session, T, END, {"USD": "0.95"})
    assert (await fx_revaluation.preview(session, T, END, {"USD": "0.95"}))["posted"] is True


async def test_payment_stores_payment_date_rate(session):
    sales, inv, p, bill = await _usd_invoice_and_bill(session)
    inv = await sales.record_payment(inv.id, amount=D("500.00"), pay_date=END, fx_rate=D("0.95"))
    assert inv.payments[-1].fx_rate == D("0.95")
    bill = await p.record_payment(bill.id, amount=D("238.00"), pay_date=END, base_amount=D("226.10"))
    assert bill.payments[-1].fx_rate == D("0.95")  # 226.10 / 238.00


async def _sales_order(session, item, qty="4"):
    inv = InventoryService(session, T)
    await inv.opening(item.id, D(10), D(8), move_date=DAY)
    sales = SalesService(session, T)
    so = await sales.create(
        "order", customer_name="ACME", doc_date=DAY, lines=[SLine("Widget", item.sku, D(qty), D(30), item_id=item.id)]
    )
    await sales.set_status(so.id, "confirmed")
    return inv, sales, so


async def test_invoice_from_undelivered_order_issues_stock_once(session):
    item = await _item(session)
    inv, sales, so = await _sales_order(session, item)
    invoice = await sales.order_to_invoice(so.id)
    await sales.issue_invoice(invoice.id)
    assert (await inv.on_hand([item.id]))[str(item.id)] == D(6)
    bal = await _bal(session)
    assert bal["3400"] == D("32.00")  # 4 x 8.00 COGS
    # Cancelling the invoice returns the stock and reverses COGS.
    await sales.set_status(invoice.id, "cancelled")
    assert (await inv.on_hand([item.id]))[str(item.id)] == D(10)
    assert (await _bal(session)).get("3400", D(0)) == D(0)


async def test_partial_invoice_then_delivery_issues_only_the_rest(session):
    item = await _item(session)
    inv, sales, so = await _sales_order(session, item)
    invoice = await sales.order_to_invoice(so.id, lines=[(so.lines[0].id, D(1))])
    await sales.issue_invoice(invoice.id)
    assert (await inv.on_hand([item.id]))[str(item.id)] == D(9)
    await sales.set_status(so.id, "delivered")
    assert (await inv.on_hand([item.id]))[str(item.id)] == D(6)
    assert (await _bal(session))["3400"] == D("32.00")


async def test_delivery_then_invoice_does_not_issue_again(session):
    item = await _item(session)
    inv, sales, so = await _sales_order(session, item)
    await sales.set_status(so.id, "delivered")
    invoice = await sales.order_to_invoice(so.id)
    await sales.issue_invoice(invoice.id)
    assert (await inv.on_hand([item.id]))[str(item.id)] == D(6)
    assert (await _bal(session))["3400"] == D("32.00")


async def test_usd_bank_account_books_at_base_and_is_not_compared_one_to_one(session):
    sales, inv, p, bill = await _usd_invoice_and_bill(session)
    bank = BankingService(session, T)
    acc = await bank.create_account(name="USD account", iban="DE02 1203 0000 0000 2020 51", currency="USD")
    await bank.import_statement(
        acc.id,
        "d;a;n;t;c" + NL + "2026-03-20;1190,00;US Client;INV;USD" + NL + "2026-03-21;-238,00;US Vendor;BILL;USD" + NL,
        fmt="csv",
        mapping={"date": "d", "amount": "a", "counterparty_name": "n", "remittance": "t", "currency": "c"},
    )
    from app.modules.banking.service import AllocationIn

    txns = {t.amount: t for t in await bank.list_transactions(acc.id)}
    gl_code = acc.gl_account_code
    # Same-currency settlement: cash in base at the booking-date rate, realised FX against the document rate.
    sales_rate = await sales._rate("USD", date(2026, 3, 20), None)
    await bank.confirm(txns[D("1190.00")].id, [AllocationIn("sales_invoice", inv.id, D("1190.00"))])
    bill_rate = await p._rate("USD", date(2026, 3, 21), None)
    await bank.confirm(txns[D("-238.00")].id, [AllocationIn("purchase_bill", bill.id, D("238.00"))])
    bal = await _bal(session)
    cash = (D("1190.00") * sales_rate).quantize(D("0.01")) - (D("238.00") * bill_rate).quantize(D("0.01"))
    assert bal[gl_code] == cash and bal.get("1400", D(0)) == D(0) and bal.get("1600", D(0)) == D(0)
    assert (inv.payments[-1].fx_rate, bill.payments[-1].fx_rate) == (sales_rate, bill_rate)

    summary = await BankingWorkspace(session, T).summary()
    row = next(a for a in summary["accounts"] if a["account_id"] == acc.id)
    assert row["gl_comparable"] is False and row["gl_difference"] is None and row["balance"] == D("952.00")
