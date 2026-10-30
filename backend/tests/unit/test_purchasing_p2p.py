"""Purchasing: PO -> partial receipts (stock) -> bills with 3-way match -> payments / credit note, GL and tenants."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.gl import service as gl_service
from app.modules.gl.models import GLJournalEntry
from app.modules.gl.service import GLService
from app.modules.items.models import Item
from app.modules.purchasing.service import (
    LineData,
    PurchasingConflictError,
    PurchasingNotFoundError,
    PurchasingService,
    PurchasingValidationError,
)
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 3, 10)
T1, T2 = "tenant-p2p-a", "tenant-p2p-b"


@pytest.fixture(autouse=True)
def _base_eur(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})


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


async def _item(session, tenant=T1, sku="W-1", tracked=True):
    it = Item(tenant_id=tenant, sku=sku, name="Widget", purchase_cost=D("10"), stock_tracked=tracked)
    session.add(it)
    await session.flush()
    return it


async def _po(svc, item, *, confirm=True):
    po = await svc.create_order(
        supplier_name="Supplier GmbH",
        doc_date=DAY,
        lines=[
            LineData("Widget", item.sku, D(10), D(10), D(19), item_id=item.id),
            LineData("Installation", "", D(1), D(50), D(19)),
        ],
    )
    if confirm:
        await svc.set_order_status(po.id, "confirmed")
    return po


async def _tb(svc):
    return await svc.gl.trial_balance(None, None)


def _closing(tb, code):
    row = next((r for r in tb["rows"] if r["code"] == code), None)
    return row["closing"] if row else D(0)


async def test_full_purchase_to_pay(svc, session):
    item = await _item(session)
    po = await _po(svc, item)
    assert po.number == "PO-000001" and po.net_total == D("150.00") and po.gross_total == D("178.50")
    w, inst = po.lines

    # Partial receipt: stock + DR inventory / CR GRNI at PO price.
    gr1 = await svc.receive(po.id, {w.id: D(4)}, doc_date=DAY)
    assert gr1.number == "GR-000001" and gr1.value_total == D("40.00") and po.status == "partially_received"
    with pytest.raises(PurchasingValidationError):
        await svc.receive(po.id, {w.id: D(7)}, doc_date=DAY)  # over-receipt
    gr2 = await svc.receive(po.id, None, doc_date=DAY)  # rest incl. service line -> expense
    assert po.status == "received" and gr2.value_total == D("110.00")
    [stock] = await svc.stock()
    assert (stock.qty, stock.value) == (D(10), D("100.00"))
    tb = await _tb(svc)
    assert _closing(tb, "3980") == D("100.00") and _closing(tb, "1720") == D("-150.00")

    # Bill from PO matches; a price change flags price variance.
    bill = await svc.bill_from_order(po.id)
    assert bill.number == "BILL-000001" and bill.match_status == "matched"
    lines = [
        LineData(ln.description, ln.sku, ln.qty, ln.unit_price, ln.tax_rate, ln.item_id, ln.order_line_id)
        for ln in bill.lines
    ]
    lines[0].unit_price = D("10.50")
    await svc.update_bill(bill.id, lines=lines)
    assert bill.match_status == "price_variance" and bill.net_total == D("155.00")
    await svc.post_bill(bill.id)
    entry = await session.get(GLJournalEntry, bill.gl_entry_id)
    assert entry.status == "posted" and sum(ln.debit for ln in entry.lines) == bill.gross_total
    tb = await _tb(svc)
    assert _closing(tb, "1720") == 0  # GRNI cleared
    assert _closing(tb, "1600") == -bill.gross_total  # payables
    assert _closing(tb, "1576") == bill.tax_total
    with pytest.raises(PurchasingConflictError):
        await svc.bill_from_order(po.id)  # fully billed

    # Partial then full payment.
    await svc.record_payment(bill.id, amount=D("100"), pay_date=DAY)
    assert bill.status == "partially_paid"
    with pytest.raises(PurchasingValidationError):
        await svc.record_payment(bill.id, amount=bill.gross_total)
    await svc.record_payment(bill.id, amount=bill.gross_total - D("100"), pay_date=DAY)
    assert bill.status == "paid"
    tb = await _tb(svc)
    assert _closing(tb, "1600") == 0 and _closing(tb, "1200") == -bill.gross_total
    assert tb["total_debit"] == tb["total_credit"]


async def test_qty_variance_and_credit_note(svc, session):
    item = await _item(session)
    po = await _po(svc, item)
    w = po.lines[0]
    await svc.receive(po.id, {w.id: D(2)}, doc_date=DAY)
    bill = await svc.create_bill(
        lines=[LineData("Widget", w.sku, D(5), D(10), D(19), item.id, w.id)],
        order_id=po.id,
        supplier_name="Supplier GmbH",
        doc_date=DAY,
    )
    assert bill.match_status == "qty_variance" and bill.lines[0].match_status == "qty_variance"
    await svc.post_bill(bill.id)
    tb = await _tb(svc)
    assert _closing(tb, "1720") == 0  # only the 2 received units cleared GRNI
    assert _closing(tb, "3400") == D("30.00")  # 3 unreceived units expensed

    cn = await svc.create_bill(
        "credit_note", lines=[LineData("Return", "", D(1), D(10), D(19))], source_id=bill.id, doc_date=DAY
    )
    assert cn.number == "CN-000001" and cn.supplier_name == "Supplier GmbH"
    await svc.post_bill(cn.id)
    assert cn.status == "applied" and bill.amount_paid == D("11.90") and bill.status == "partially_paid"
    s = await svc.summary(today=date(2026, 5, 1))
    assert s["payables"] == bill.gross_total - D("11.90") and s["overdue_count"] == 1
    assert s["open_po_value"] == po.gross_total
    tb = await _tb(svc)
    assert tb["total_debit"] == tb["total_credit"]
    assert _closing(tb, "1600") == -(bill.gross_total - D("11.90"))


async def test_standalone_bill_and_rules(svc, session):
    bill = await svc.create_bill(
        lines=[LineData("Rent", "", D(1), D(1000), D(0))], supplier_name="Landlord", doc_date=DAY
    )
    assert bill.match_status == "none"
    await svc.post_bill(bill.id)
    tb = await _tb(svc)
    assert _closing(tb, "3400") == D("1000.00") and _closing(tb, "1600") == D("-1000.00")
    await svc.cancel_bill(bill.id)
    assert bill.status == "cancelled" and _closing(await _tb(svc), "1600") == 0

    item = await _item(session, sku="W-2")
    draft = await _po(svc, item, confirm=False)
    with pytest.raises(PurchasingConflictError):
        await svc.receive(draft.id)


async def test_tenant_isolation(svc, session):
    item = await _item(session)
    po = await _po(svc, item)
    other = PurchasingService(session, T2)
    with pytest.raises(PurchasingNotFoundError):
        await other.get_order(po.id)
    with pytest.raises(PurchasingNotFoundError):
        await other.receive(po.id)
    assert await other.list_orders() == [] and await other.list_receipts() == []
    # Numbering is per tenant; items of another tenant are not visible.
    foreign = await _item(session, tenant=T2, sku="F-1")
    with pytest.raises(PurchasingValidationError):
        await svc.create_order(lines=[LineData("x", "F-1", D(1), D(1), D(0), item_id=foreign.id)])
    po2 = await other.create_order(lines=[LineData("Foreign", "F-1", D(1), D(1), D(0), item_id=foreign.id)])
    assert po2.number == "PO-000001"
    assert (await other.summary())["open_po_value"] == 0


async def test_grni_default_uses_dedicated_account_with_fallback(svc, session):
    from sqlalchemy import delete

    from app.modules.gl.models import GLAccount

    assert (await svc.account_mapping())["grni"] == "1720"
    await session.execute(delete(GLAccount).where(GLAccount.tenant_id == T1, GLAccount.code == "1720"))
    assert (await svc.account_mapping())["grni"] == "1700"
