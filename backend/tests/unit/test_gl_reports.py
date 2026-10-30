"""GL reports: trial balance, account ledger, P&L, balance sheet."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService, LineInput
from tests._pg import transactional_session

D = Decimal


@pytest.fixture(autouse=True)
def _base_eur(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})


@pytest_asyncio.fixture
async def svc():
    async with transactional_session() as s:
        svc = GLService(s)
        await svc.load_template("ifrs_generic")
        await svc.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
        acc = {a.code: a.id for a in await svc.list_accounts()}

        async def post(on, dr, cr, amt, draft=False):
            return await svc.create_entry(
                entry_date=on,
                lines=[LineInput(acc[dr], debit=D(amt)), LineInput(acc[cr], credit=D(amt))],
                post=not draft,
            )

        await post(date(2026, 1, 2), "1710", "3000", "10000.00")  # capital paid in
        await post(date(2026, 2, 10), "1400", "4000", "5000.00")  # revenue on account
        await post(date(2026, 2, 20), "5100", "2200", "3000.00")  # subcontractor cost
        await post(date(2026, 3, 5), "1710", "1400", "2000.00")  # customer pays
        await post(date(2026, 3, 6), "5500", "1710", "999.00", draft=True)  # draft: excluded
        svc.acc = acc  # type: ignore[attr-defined]
        yield svc


async def test_trial_balance_balances_and_has_opening(svc):
    tb = await svc.trial_balance(date(2026, 2, 1), date(2026, 3, 31))
    assert tb["balanced"]
    assert tb["total_debit"] == tb["total_credit"] == D("10000.00")
    bank = next(r for r in tb["rows"] if r["code"] == "1710")
    assert bank["opening"] == D("10000.00") and bank["closing"] == D("12000.00")
    assert not any(r["code"] == "5500" for r in tb["rows"])


async def test_account_ledger_running_balance(svc):
    led = await svc.account_ledger(svc.acc["1400"], None, None)
    assert [r["balance"] for r in led["rows"]] == [D("5000.00"), D("3000.00")]
    assert led["closing"] == D("3000.00")
    led_mar = await svc.account_ledger(svc.acc["1400"], date(2026, 3, 1), None)
    assert led_mar["opening"] == D("5000.00") and len(led_mar["rows"]) == 1


async def test_profit_and_loss(svc):
    pl = await svc.profit_and_loss(date(2026, 1, 1), date(2026, 12, 31))
    assert pl["income"]["total"] == D("5000.00")
    assert pl["expense"]["total"] == D("3000.00")
    assert pl["net_income"] == D("2000.00")
    q1 = await svc.profit_and_loss(date(2026, 1, 1), date(2026, 1, 31))
    assert q1["net_income"] == 0


async def test_balance_sheet_equation(svc):
    bs = await svc.balance_sheet(date(2026, 12, 31))
    assert bs["total_assets"] == D("15000.00")
    assert bs["liability"]["total"] == D("3000.00")
    assert bs["equity"]["total"] == D("10000.00")
    assert bs["unclosed_earnings"] == D("2000.00")
    assert bs["balanced"]
    early = await svc.balance_sheet(date(2026, 1, 31))
    assert early["total_assets"] == D("10000.00") and early["balanced"]


async def test_vat_report_nets_output_against_input(svc):
    a = svc.acc
    await svc.create_entry(
        entry_date=date(2026, 4, 1),
        lines=[
            LineInput(a["1400"], debit=D("119")),
            LineInput(a["4000"], credit=D("100")),
            LineInput(a["2300"], credit=D("19")),
        ],
        post=True,
    )
    await svc.create_entry(
        entry_date=date(2026, 4, 2),
        lines=[
            LineInput(a["5100"], debit=D("50")),
            LineInput(a["1450"], debit=D("9.50")),
            LineInput(a["2200"], credit=D("59.50")),
        ],
        post=True,
    )
    rep = await svc.vat_report(date(2026, 4, 1), date(2026, 4, 30), ["2300"], ["1450"])
    assert rep["output_vat"] == D("19") and rep["input_vat"] == D("9.50") and rep["net_payable"] == D("9.50")


async def test_kpis_count_drafts_and_ytd(svc):
    k = await svc.kpis(date(2026, 3, 31))
    assert k["draft_entries"] == 1 and k["revenue_ytd"] == D("5000.00") and k["balanced"]


async def test_attachments_are_tenant_scoped_and_size_checked(svc):
    from app.modules.gl.service import GLNotFoundError, GLValidationError

    entry = (await svc.list_entries())[0]
    att = await svc.add_attachment(entry.id, "receipt.pdf", "application/pdf", b"%PDF-1")
    assert [a.filename for a in await svc.list_attachments(entry.id)] == ["receipt.pdf"]
    with pytest.raises(GLValidationError):
        await svc.add_attachment(entry.id, "empty.txt", None, b"")
    other = GLService(svc.session, "other-tenant")
    with pytest.raises(GLNotFoundError):
        await other.get_attachment(att.id)
    await svc.delete_attachment(att.id)
    assert await svc.list_attachments(entry.id) == []
