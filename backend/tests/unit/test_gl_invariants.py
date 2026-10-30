"""GL invariants: balance, immutability, closed periods, reversal, numbering."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio

from app.modules.gl import service as gl_service
from app.modules.gl.service import (
    GLConflictError,
    GLService,
    GLValidationError,
    LineInput,
)
from app.modules.gl.templates import DE_SKR03, IFRS_GENERIC
from tests._pg import transactional_session

D = Decimal


@pytest.fixture(autouse=True)
def _base_eur(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})


@pytest_asyncio.fixture
async def svc():
    async with transactional_session() as s:
        svc = GLService(s)
        await svc.load_template("de_skr03")
        await svc.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
        yield svc


async def _acc(svc: GLService, code: str):
    return next(a for a in await svc.list_accounts() if a.code == code)


async def _sale(svc: GLService, amount: str = "119.00", on: date = date(2026, 3, 10), **kw):
    bank, rev, vat = await _acc(svc, "1200"), await _acc(svc, "8400"), await _acc(svc, "1776")
    net = (D(amount) / D("1.19")).quantize(D("0.01"))
    return await svc.create_entry(
        entry_date=on,
        lines=[
            LineInput(bank.id, debit=D(amount)),
            LineInput(rev.id, credit=net),
            LineInput(vat.id, credit=D(amount) - net, tax_code="USt19"),
        ],
        **kw,
    )


def test_templates_sizes_and_unique_codes():
    for tpl, lo in ((IFRS_GENERIC, 40), (DE_SKR03, 60)):
        codes = [r[0] for r in tpl]
        assert len(codes) >= lo
        assert len(set(codes)) == len(codes)


async def test_template_load_is_idempotent(svc):
    res = await svc.load_template("de_skr03")
    assert res["created"] == 0 and res["skipped"] == len(DE_SKR03)


async def test_unbalanced_entry_cannot_post(svc):
    bank, rev = await _acc(svc, "1200"), await _acc(svc, "8400")
    entry = await svc.create_entry(
        entry_date=date(2026, 2, 1),
        lines=[LineInput(bank.id, debit=D("100.00")), LineInput(rev.id, credit=D("99.99"))],
    )
    with pytest.raises(GLValidationError, match="balance"):
        await svc.post_entry(entry.id)
    assert entry.status == "draft" and entry.number is None


async def test_line_must_have_exactly_one_side(svc):
    bank = await _acc(svc, "1200")
    with pytest.raises(GLValidationError):
        await svc.create_entry(
            entry_date=date(2026, 2, 1),
            lines=[LineInput(bank.id, debit=D(1), credit=D(1)), LineInput(bank.id, credit=D(0))],
        )


async def test_posted_entry_is_immutable(svc):
    entry = await _sale(svc, post=True)
    assert entry.status == "posted"
    with pytest.raises(GLConflictError):
        await svc.update_draft(entry.id, memo="changed")
    with pytest.raises(GLConflictError):
        await svc.delete_draft(entry.id)
    with pytest.raises(GLConflictError):
        await svc.post_entry(entry.id)


async def test_no_posting_into_closed_period(svc):
    draft = await _sale(svc, on=date(2026, 4, 5))
    await svc.set_period_status(draft.period_id, "closed")
    with pytest.raises(GLConflictError, match="closed"):
        await svc.post_entry(draft.id)
    with pytest.raises(GLConflictError, match="closed"):
        await _sale(svc, on=date(2026, 4, 20))


async def test_reversal_mirrors_and_marks_original(svc):
    orig = await _sale(svc, post=True)
    rev = await svc.reverse_entry(orig.id, on=date(2026, 3, 31))
    assert orig.status == "reversed" and orig.reversed_by_id == rev.id
    assert rev.status == "posted" and rev.reversal_of_id == orig.id
    for a, b in zip(orig.lines, rev.lines, strict=True):
        assert (a.account_id, a.base_debit, a.base_credit) == (b.account_id, b.base_credit, b.base_debit)
    with pytest.raises(GLConflictError):
        await svc.reverse_entry(orig.id)
    tb = await svc.trial_balance(None, None)
    assert all(r["closing"] == 0 for r in tb["rows"])


async def test_sequential_numbering_per_fiscal_year(svc):
    await svc.create_fiscal_year("FY2027", date(2027, 1, 1), date(2027, 12, 31))
    draft = await _sale(svc)  # draft does not consume a number
    e1 = await _sale(svc, post=True)
    e2 = await _sale(svc, post=True)
    e3 = await _sale(svc, on=date(2027, 1, 15), post=True)
    await svc.post_entry(draft.id)
    assert (e1.number, e2.number, draft.number) == ("FY2026-000001", "FY2026-000002", "FY2026-000003")
    assert e3.number == "FY2027-000001"


async def test_fx_entry_balances_in_base_currency(svc):
    entry = await _sale(svc, amount="100.00", currency="USD", fx_rate=D("0.9"), post=True)
    assert entry.base_currency == "EUR"
    assert sum(ln.base_debit for ln in entry.lines) == D("90.00")
    with pytest.raises(GLValidationError, match="fx_rate"):
        await _sale(svc, currency="USD")


async def test_non_postable_account_rejected(svc):
    acc = await _acc(svc, "1200")
    await svc.update_account(acc.id, is_postable=False)
    with pytest.raises(GLValidationError, match="not postable"):
        await _sale(svc)


async def test_no_period_for_date(svc):
    with pytest.raises(GLValidationError, match="No accounting period"):
        await _sale(svc, on=date(2030, 1, 1))
