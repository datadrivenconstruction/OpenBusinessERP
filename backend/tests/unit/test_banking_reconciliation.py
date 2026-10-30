"""Banking: statement parsers, match scoring, confirmation posting, partial/split, write-off, isolation."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.modules.banking.matching import BankLine, OpenItem, number_hit, suggest
from app.modules.banking.models import BankPartnerIban
from app.modules.banking.parsers import detect_format, parse_amount, parse_camt, parse_csv, parse_mt940
from app.modules.banking.service import AllocationIn, BankingConflictError, BankingNotFoundError, BankingService
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.purchasing.service import LineData as PLine
from app.modules.purchasing.service import PurchasingService
from app.modules.sales.service import LineData, SalesService
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 3, 1)
FIX = Path(__file__).resolve().parents[1] / "fixtures" / "banking"


# ── Parsers ───────────────────────────────────────────────────────────────
def test_parse_camt053():
    data = (FIX / "camt053_sample.xml").read_bytes()
    assert detect_format(data) == "camt053"
    txns = parse_camt(data)
    assert len(txns) == 4
    t = txns[0]
    assert (t.amount, t.currency, t.booking_date) == (D("1190.00"), "EUR", date(2026, 3, 11))
    assert t.counterparty_name == "Acme Builders GmbH" and t.counterparty_iban == "DE02120300000000202051"
    assert "INV-000001" in t.remittance and t.reference == "E2E-ACME-1"
    assert txns[1].amount == D("-45.90") and txns[1].counterparty_name == "Office Supply Store"
    assert txns[1].reference == "BANKREF-0002"
    # batch entry split into its transaction details
    assert [x.amount for x in txns[2:]] == [D("100.00"), D("200.00")]
    assert {x.reference for x in txns[2:]} == {"BATCH-9/1", "BATCH-9/2"}


def test_camt_rejects_entity_expansion():
    evil = b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaa">]><Document>&a;</Document>'
    with pytest.raises(ValueError):
        parse_camt(evil)


def test_parse_mt940():
    data = (FIX / "mt940_sample.sta").read_bytes()
    assert detect_format(data) == "mt940"
    t1, t2 = parse_mt940(data)
    assert (t1.amount, t1.currency, t1.booking_date) == (D("1190.00"), "EUR", date(2026, 3, 11))
    assert t1.counterparty_name == "ACME BUILDERS GMBH" and t1.counterparty_iban == "DE02120300000000202051"
    assert "INV-000001" in t1.remittance and t1.reference.endswith("BREF-77")
    assert t2.amount == D("-45.90") and "7781" in t2.remittance and t2.reference.endswith("KREF-55")


def test_parse_csv_semicolon_comma_decimal():
    data = (FIX / "csv_semicolon_comma.csv").read_bytes()
    mapping = {"date": "Buchungstag", "value_date": "Wertstellung", "amount": "Betrag", "currency": "Währung",
               "counterparty_name": "Empfänger/Auftraggeber", "counterparty_iban": "IBAN",
               "remittance": "Verwendungszweck"}
    t1, t2 = parse_csv(data, mapping)
    assert (t1.amount, t1.booking_date, t1.counterparty_iban) == (D("1190.00"), date(2026, 3, 11), "DE02120300000000202051")
    assert t2.amount == D("-45.90") and t1.reference == "" and t1.dedupe_key.startswith("h:")


def test_parse_csv_comma_debit_credit():
    data = (FIX / "csv_comma_dot.csv").read_text()
    mapping = {"date": "date", "debit": "debit", "credit": "credit", "counterparty_name": "payee",
               "remittance": "memo", "reference": "ref"}
    t1, t2 = parse_csv(data, mapping)
    assert t1.amount == D("1190.00") and t2.amount == D("-45.90") and t1.reference == "TX-1"


def test_parse_amount_variants():
    assert parse_amount("1.234,56") == D("1234.56")
    assert parse_amount("1,234.56") == D("1234.56")
    assert parse_amount("12,50-") == D("-12.50")
    assert parse_amount("1.234.567") == D("1234567")


# ── Scoring ───────────────────────────────────────────────────────────────
def _item(number, partner, amount, due=date(2026, 3, 10), kind="sales_invoice", ibans=()):
    return OpenItem(kind, uuid.uuid4(), number, partner, D(amount), "EUR", due, due, partner, tuple(ibans))


def test_scoring_prefers_number_and_amount():
    line = BankLine(D("1190.00"), date(2026, 3, 11), "EUR", "Acme Builders GmbH", "DE02", "Payment INV-000001")
    good = _item("INV-000001", "Acme Builders GmbH", "1190.00", ibans=("DE02",))
    same_amount = _item("INV-000002", "Other Ltd", "1190.00")
    bill = _item("BILL-1", "Acme Builders GmbH", "1190.00", kind="purchase_bill")
    out = suggest(line, [same_amount, good, bill])
    assert out[0].allocations[0].id == good.id and out[0].score >= 0.95
    assert all(a.kind == "sales_invoice" for s in out for a in s.allocations)
    assert out[0].score > out[1].score
    assert number_hit("INV-000123", "re 123 thanks") > 0 and number_hit("INV-000123", "1234") == 0


def test_scoring_tolerance_and_split():
    a = _item("INV-000010", "Beta AG", "100.00")
    b = _item("INV-000011", "Beta AG", "250.00")
    line = BankLine(D("349.98"), date(2026, 3, 12), "EUR", "Beta AG", "", "INV-000010 INV-000011")
    top = suggest(line, [a, b], tolerance=D("0.05"))[0]
    assert top.is_split and {x.id for x in top.allocations} == {a.id, b.id}
    assert sum(x.amount for x in top.allocations) == D("349.98")


# ── Posting (PostgreSQL) ──────────────────────────────────────────────────
@pytest.fixture(autouse=True)
def _base_eur(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


async def _setup(session, tenant="default"):
    gl = GLService(session, tenant)
    await gl.load_template("de_skr03")
    await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
    sales = SalesService(session, tenant)
    bank = BankingService(session, tenant)
    acc = await bank.create_account(name="Main", iban="DE89 3704 0044 0532 0130 00")
    await bank.update_settings(writeoff_account_code="4900", writeoff_max=D("5.00"))
    return gl, sales, bank, acc


async def _invoice(sales, name, net, due=date(2026, 3, 10)):
    inv = await sales.create("invoice", lines=[LineData("Work", "", D(1), D(net), D(0), D(19))],
                             doc_date=DAY, due_date=due, customer_name=name)
    return await sales.issue_invoice(inv.id)


async def _assert_tb(gl):
    tb = await gl.trial_balance(None, None)
    assert tb["balanced"], tb
    return {r["code"]: r["closing"] for r in tb["rows"]}


async def test_import_dedupe_and_confirm_posts_payment(session):
    gl, sales, bank, acc = await _setup(session)
    inv = await _invoice(sales, "Acme Builders GmbH", "1000")
    data = (FIX / "camt053_sample.xml").read_bytes()
    st = await bank.import_statement(acc.id, data, filename="s.xml")
    again = await bank.import_statement(acc.id, data)
    assert (st.imported_count, again.imported_count, again.duplicate_count) == (4, 0, 4)
    txn = next(t for t in await bank.list_transactions(acc.id) if t.amount == D("1190.00"))
    sug = await bank.suggestions(txn.id)
    assert sug[0].allocations[0].id == inv.id and sug[0].score >= 0.7
    await bank.confirm(txn.id, [AllocationIn("sales_invoice", inv.id, D("1190.00"))], confidence=sug[0].score)
    assert txn.status == "matched" and inv.status == "paid"
    bal = await _assert_tb(gl)
    assert bal["1400"] == 0 and bal["1200"] == D("1190.00")
    # The IBAN is learned for the next suggestion round.
    learned = await session.scalar(select(BankPartnerIban.iban).where(BankPartnerIban.partner_key == "name:acmebuildersgmbh"))
    assert learned == "DE02120300000000202051"


async def test_partial_and_split(session):
    gl, sales, bank, acc = await _setup(session)
    i1 = await _invoice(sales, "Beta AG", "100")  # 119.00
    i2 = await _invoice(sales, "Beta AG", "200")  # 238.00
    csv = "date;amount;name;text\n2026-03-12;357,00;Beta AG;INV-000001 INV-000002\n2026-03-13;50,00;Beta AG;part\n"
    await bank.import_statement(acc.id, csv, fmt="csv", mapping={
        "date": "date", "amount": "amount", "counterparty_name": "name", "remittance": "text"})
    lines = sorted(await bank.list_transactions(acc.id), key=lambda t: t.booking_date)
    split, part = lines
    top = (await bank.suggestions(split.id))[0]
    assert top.is_split
    await bank.confirm(split.id, [AllocationIn(a.kind, a.id, a.amount) for a in top.allocations])
    assert split.status == "matched" and i1.status == "paid" and i2.status == "paid"
    i3 = await _invoice(sales, "Beta AG", "100")
    await bank.confirm(part.id, [AllocationIn("sales_invoice", i3.id, D("30.00"))])
    assert part.status == "partially_matched" and i3.status == "partially_paid"
    await bank.confirm(part.id, [AllocationIn("sales_invoice", i3.id, D("20.00"))])
    assert part.status == "matched" and i3.amount_paid == D("50.00")
    await _assert_tb(gl)


async def test_writeoff_small_difference(session):
    gl, sales, bank, acc = await _setup(session)
    inv = await _invoice(sales, "Gamma", "100")  # 119.00
    await bank.import_statement(acc.id, "d;a\n2026-03-12;117,50\n", fmt="csv", mapping={"date": "d", "amount": "a"})
    (txn,) = await bank.list_transactions(acc.id)
    await bank.confirm(txn.id, [AllocationIn("sales_invoice", inv.id, D("117.50"))], write_off_difference=True)
    assert inv.status == "paid" and txn.status == "matched"
    assert {m.target_type for m in txn.matches} == {"sales_invoice", "write_off"}
    bal = await _assert_tb(gl)
    assert bal["4900"] == D("1.50") and bal["1400"] == 0


async def test_manual_entry_and_overallocation(session):
    gl, _sales, bank, acc = await _setup(session)
    await bank.import_statement(acc.id, "d;a;t\n2026-03-12;-12,00;fees\n", fmt="csv",
                                mapping={"date": "d", "amount": "a", "remittance": "t"})
    (txn,) = await bank.list_transactions(acc.id)
    await bank.manual_entry(txn.id, account_code="4970")
    assert txn.status == "matched"
    bal = await _assert_tb(gl)
    assert bal["4970"] == D("12.00") and bal["1200"] == D("-12.00")
    with pytest.raises(BankingConflictError):
        await bank.manual_entry(txn.id, account_code="4970")


async def test_supplier_bill_payment(session):
    gl, _sales, bank, acc = await _setup(session)
    purch = PurchasingService(session)
    bill = await purch.create_bill(lines=[PLine("Material", "", D(1), D(100), D(19))],
                                   supplier_name="Supplier GmbH", doc_date=DAY)
    await purch.post_bill(bill.id)
    await bank.import_statement(acc.id, "d;a;n\n2026-03-12;-119,00;Supplier GmbH\n", fmt="csv",
                                mapping={"date": "d", "amount": "a", "counterparty_name": "n"})
    (txn,) = await bank.list_transactions(acc.id)
    top = (await bank.suggestions(txn.id))[0]
    assert top.allocations[0].id == bill.id
    await bank.confirm(txn.id, [AllocationIn("purchase_bill", bill.id, D("119.00"))])
    assert bill.status == "paid" and txn.status == "matched"
    bal = await _assert_tb(gl)
    assert bal["1600"] == 0


async def test_tenant_isolation(session):
    _gl, sales, bank, acc = await _setup(session, "default")
    inv = await _invoice(sales, "Acme", "10")
    other = BankingService(session, "tenant-b")
    with pytest.raises(BankingNotFoundError):
        await other.get_account(acc.id)
    assert await other.list_accounts() == []
    assert all(i.id != inv.id for i in await other.open_items())
    await bank.import_statement(acc.id, "d;a\n2026-03-12;11,90\n", fmt="csv", mapping={"date": "d", "amount": "a"})
    (txn,) = await bank.list_transactions()
    assert await other.list_transactions() == []
    with pytest.raises(BankingNotFoundError):
        await other.confirm(txn.id, [AllocationIn("sales_invoice", inv.id, D("11.90"))])


async def test_undo_match_reverses_payment(session):
    gl, sales, bank, acc = await _setup(session)
    inv = await _invoice(sales, "Gamma", "100")  # 119.00
    await bank.import_statement(acc.id, "d;a\n2026-03-12;117,50\n", fmt="csv", mapping={"date": "d", "amount": "a"})
    (txn,) = await bank.list_transactions(acc.id)
    await bank.confirm(txn.id, [AllocationIn("sales_invoice", inv.id, D("117.50"))], write_off_difference=True)
    await bank.undo_match(txn.id)
    assert txn.status == "unmatched" and txn.matched_amount == 0 and not txn.matches
    assert inv.status == "issued" and inv.amount_paid == 0 and not inv.payments
    bal = await _assert_tb(gl)
    assert bal["1400"] == D("119.00") and bal["1200"] == 0 and bal["4900"] == 0
    with pytest.raises(BankingConflictError):
        await bank.undo_match(txn.id)
    await bank.confirm(txn.id, [AllocationIn("sales_invoice", inv.id, D("117.50"))])
    assert txn.status == "matched" and inv.status == "partially_paid"


async def test_supplier_writeoff_default_account_and_undo(session):
    gl, _sales, bank, acc = await _setup(session)
    await bank.update_settings(writeoff_account_code="")
    cfg = await bank.settings()
    cfg.writeoff_account_code = ""  # resolve the default from the SKR03 chart
    purch = PurchasingService(session)
    bill = await purch.create_bill(lines=[PLine("Material", "", D(1), D(100), D(19))],
                                   supplier_name="Supplier GmbH", doc_date=DAY)
    await purch.post_bill(bill.id)
    await bank.import_statement(acc.id, "d;a\n2026-03-12;-118,00\n", fmt="csv", mapping={"date": "d", "amount": "a"})
    (txn,) = await bank.list_transactions(acc.id)
    await bank.confirm(txn.id, [AllocationIn("purchase_bill", bill.id, D("118.00"))], write_off_difference=True)
    assert bill.status == "paid" and txn.status == "matched"
    assert {m.target_type for m in txn.matches} == {"purchase_bill", "bill_write_off"}
    bal = await _assert_tb(gl)
    assert bal["1600"] == 0 and bal["4900"] == D("-1.00") and bal["1200"] == D("-118.00")
    await bank.undo_match(txn.id)
    assert bill.status == "posted" and bill.amount_paid == 0 and txn.status == "unmatched"
    bal = await _assert_tb(gl)
    assert bal["1600"] == D("-119.00") and bal["4900"] == 0 and bal["1200"] == 0
