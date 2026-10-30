"""Banking workspace: rules matching, import preview/dedupe, KPI summary, bulk accept, rules apply, isolation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from pathlib import Path

import pytest
import pytest_asyncio

from app.modules.banking.rules import LineText, first_match, rule_matches, valid_pattern
from app.modules.banking.service import BankingConflictError, BankingNotFoundError, BankingValidationError
from app.modules.banking.workspace import BankingWorkspace
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.sales.service import LineData, SalesService
from tests._pg import transactional_session

D = Decimal
DAY = date(2026, 3, 1)
FIX = Path(__file__).resolve().parents[1] / "fixtures" / "banking"


@dataclass
class R:
    pattern: str
    match_field: str = "any"
    direction: str = "any"
    min_amount: Decimal | None = None
    max_amount: Decimal | None = None
    priority: int = 100
    active: bool = True
    name: str = "r"


# ── Pure rule matching ────────────────────────────────────────────────────
def test_rule_matching_fields_direction_and_range():
    fee = LineText(D("-45.90"), "Office Supply Store", "DE11", "Order 7781 Bürobedarf", "BANKREF-2")
    assert rule_matches(R("office supply", "counterparty"), fee)
    assert rule_matches(R("burobedarf", "text"), fee)  # accent-folded
    assert not rule_matches(R("office", "text"), fee)
    assert not rule_matches(R("office", direction="in"), fee)
    assert rule_matches(R("office", direction="out", max_amount=D("50")), fee)
    assert not rule_matches(R("office", min_amount=D("50")), fee)
    assert not rule_matches(R("office", active=False), fee)
    assert rule_matches(R("de 11", "iban"), fee)
    assert rule_matches(R(r"/order\s+\d{4}/", "text"), fee)
    assert not valid_pattern("/[unclosed/") and not valid_pattern("  ")
    assert first_match([R("store", priority=50, name="b"), R("office", priority=10, name="a")], fee).name == "a"


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
    ws = BankingWorkspace(session, tenant)
    acc = await ws.create_account(name="Main", iban="DE89 3704 0044 0532 0130 00")
    return sales, ws, acc


async def _invoice(sales, name, net):
    inv = await sales.create(
        "invoice",
        lines=[LineData("Work", "", D(1), D(net), D(0), D(19))],
        doc_date=DAY,
        due_date=date(2026, 3, 10),
        customer_name=name,
    )
    return await sales.issue_invoice(inv.id)


async def test_preview_flags_duplicates_without_writing(session):
    _, ws, acc = await _setup(session)
    data = (FIX / "camt053_sample.xml").read_bytes()
    pv = await ws.preview_import(acc.id, data)
    assert (pv["format"], pv["total"], pv["new_count"], pv["duplicate_count"]) == ("camt053", 4, 4, 0)
    assert pv["total_in"] == D("1490.00") and pv["total_out"] == D("-45.90") and not pv["currency_mismatch"]
    assert await ws.list_transactions(acc.id) == []
    await ws.import_statement(acc.id, data)
    again = await ws.preview_import(acc.id, data)
    assert again["new_count"] == 0 and again["duplicate_count"] == 4
    assert {r["state"] for r in again["rows"]} == {"duplicate"}
    with pytest.raises(BankingValidationError):
        await ws.preview_import(acc.id, b"a;b\n1;2", fmt="csv")


async def test_summary_bulk_accept_and_rules(session):
    sales, ws, acc = await _setup(session)
    inv = await _invoice(sales, "Acme Builders GmbH", "1000")
    await ws.import_statement(acc.id, (FIX / "camt053_sample.xml").read_bytes())
    s0 = await ws.summary(today=date.today())
    assert s0["unmatched_count"] == 4 and s0["accounts"][0]["balance"] == D("1444.10")
    assert s0["accounts"][0]["unmatched_count"] == 4 and s0["matched_this_month"] == 0

    res = await ws.bulk_accept(min_score=0.7)
    assert len(res.accepted) == 1 and res.skipped == 3 and inv.status == "paid"

    with pytest.raises(BankingConflictError):
        await ws.create_rule(name="Bad", pattern="office", account_code="NOPE")
    with pytest.raises(BankingValidationError):
        await ws.create_rule(name="Bad", pattern="/[x/", account_code="4930")
    rule = await ws.create_rule(
        name="Office", match_field="counterparty", pattern="office supply", direction="out", account_code="4930"
    )
    fee = next(t for t in await ws.list_transactions(acc.id) if t.amount == D("-45.90"))
    assert (await ws.rule_for(fee.id)).id == rule.id
    dry = await ws.apply_rules(dry_run=True)
    assert dry["applied"] == 0 and [h["transaction_id"] for h in dry["hits"]] == [fee.id]
    assert fee.status == "unmatched"
    done = await ws.apply_rules()
    assert done["applied"] == 1 and fee.status == "matched" and rule.hit_count == 1
    assert fee.matches[0].target_type == "gl_entry" and fee.matches[0].target_number == "4930"

    s1 = await ws.summary(today=date.today())
    assert s1["unmatched_count"] == 2 and s1["matched_this_month"] == 2 and s1["active_rules"] == 1
    await ws.update_rule(rule.id, active=False)
    assert (await ws.summary())["active_rules"] == 0
    await ws.delete_rule(rule.id)
    assert await ws.list_rules() == []


async def test_rules_are_tenant_scoped(session):
    _, ws_a, _ = await _setup(session, "tenant-a")
    rule = await ws_a.create_rule(name="Fees", pattern="fee", account_code="4970")
    ws_b = BankingWorkspace(session, "tenant-b")
    assert await ws_b.list_rules() == []
    with pytest.raises(BankingNotFoundError):
        await ws_b.update_rule(rule.id, name="x")
    with pytest.raises(BankingNotFoundError):
        await ws_b.delete_rule(rule.id)
    assert (await ws_b.summary())["accounts"] == []


_CAMT_BAL = (
    '<Bal><Tp><CdOrPrtry><Cd>OPBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">250.50</Amt>'
    "<CdtDbtInd>DBIT</CdtDbtInd><Dt><Dt>2026-03-10</Dt></Dt></Bal>"
)


def test_parse_opening_balance_camt_and_mt940():
    from app.modules.banking.parsers import parse_opening_balance

    camt = (FIX / "camt053_sample.xml").read_text(encoding="utf-8")
    assert parse_opening_balance(camt) is None
    camt = camt.replace("<Ntry>", _CAMT_BAL + "<Ntry>", 1)
    assert parse_opening_balance(camt) == (D("-250.50"), date(2026, 3, 10))
    mt = (FIX / "mt940_sample.sta").read_bytes()
    assert parse_opening_balance(mt) == (D("10000.00"), date(2026, 3, 10))
    assert parse_opening_balance(b"a;b\n1;2", "csv") is None


async def test_summary_adds_opening_balance_and_compares_ledger(session):
    _, ws, acc = await _setup(session)
    await ws.update_account(acc.id, opening_balance=D("500"), opening_balance_date=date(2026, 3, 1))
    await ws.import_statement(acc.id, (FIX / "camt053_sample.xml").read_bytes())
    row = (await ws.summary())["accounts"][0]
    assert row["opening_balance"] == D("500.00") and row["balance"] == D("1944.10")
    assert row["gl_account_code"] and row["gl_balance"] == D("0")
    assert row["gl_difference"] == D("1944.10")


async def test_import_sets_opening_balance_only_on_first_statement(session):
    _, ws, acc = await _setup(session)
    camt = (FIX / "camt053_sample.xml").read_text(encoding="utf-8").replace("<Ntry>", _CAMT_BAL + "<Ntry>", 1)
    await ws.import_statement(acc.id, camt)
    assert (acc.opening_balance, acc.opening_balance_date) == (D("-250.50"), date(2026, 3, 10))
    await ws.import_statement(acc.id, (FIX / "mt940_sample.sta").read_bytes())
    assert acc.opening_balance == D("-250.50")
