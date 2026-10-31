"""Business demo cases: every case seeds, the ledger balances, reruns are no-ops."""

from __future__ import annotations

import re
from datetime import date, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.core import business_demo
from app.core.business_demo import (
    CASES,
    EXPENSE_ACCOUNTS,
    install_business_demo,
    installed_cases,
    reinstall_business_demo,
)
from app.core.onboarding_presets import BUSINESS_PRESET_KEYS
from app.modules.crm.models import Account, Opportunity
from app.modules.gl import service as gl_service
from app.modules.gl.models import GLAccount, GLJournalEntry, GLJournalLine
from app.modules.gl.service import GLService
from app.modules.items.models import Item, ItemPriceBreak
from app.modules.sales.models import SalesDocument
from app.modules.tasks.models import Task
from app.modules.users.models import User
from tests._pg import transactional_session

TODAY = date(2026, 6, 30)
GOODS_CASES = {"trade_distribution", "manufacturing", "retail_ecommerce"}


async def _figures(session, key):
    """Month-end bank balances, payables balance, period revenue and expenses (base currency)."""
    codes = EXPENSE_ACCOUNTS["de_skr03" if CASES[key].country == "DE" else "ifrs_generic"]
    rows = (
        await session.execute(
            select(
                GLAccount.code,
                GLAccount.account_type,
                GLJournalEntry.entry_date,
                GLJournalLine.base_debit - GLJournalLine.base_credit,
            )
            .join(GLJournalLine, GLJournalLine.account_id == GLAccount.id)
            .join(GLJournalEntry, GLJournalEntry.id == GLJournalLine.entry_id)
        )
    ).all()
    ends = [date(2026, m, 1) - timedelta(days=1) for m in range(2, 7)] + [TODAY]
    bank = [sum(v for c, _, d, v in rows if c == codes["bank"] and d <= e) for e in ends]
    payables = -sum(v for c, _, _, v in rows if c == codes["payables"])
    income = -sum(v for _, t, _, v in rows if t == "income")
    expense = sum(v for _, t, _, v in rows if t == "expense")
    return bank, payables, income, expense


def business_demo_line_sku():
    from app.modules.sales.models import SalesLine

    return SalesLine.sku


def _settings(country: str, currency: str):
    return lambda: {"country_code": country, "base_currency": currency, "industry": ""}


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


def test_every_business_preset_has_a_case():
    assert set(BUSINESS_PRESET_KEYS) - {"business_all"} <= set(CASES)


def test_no_construction_vocabulary():
    words = re.compile(r"construct|\bBOQ\b|tender|subcontract|contractor|building site|scaffold", re.I)
    for case in CASES.values():
        assert not words.search(repr(case)), case.key


@pytest.mark.parametrize("key", sorted(CASES))
async def test_case_seeds_balanced_and_idempotent(session, monkeypatch, key):
    case = CASES[key]
    currency = "GBP" if case.country == "GB" else "PLN" if case.country == "PL" else "EUR"
    monkeypatch.setattr(gl_service, "read_business_settings", _settings(case.country, currency))
    monkeypatch.setattr(business_demo, "read_business_settings", _settings(case.country, currency))
    owner = User(email=f"{key}@example.com", hashed_password="x", full_name="Owner", role="admin")
    session.add(owner)
    await session.flush()

    res = await install_business_demo(session, key, owner_id=owner.id, today=TODAY)
    assert not res["already_installed"] and res["currency"] == currency
    assert res["invoices"] >= 5 and res["payments"] >= 3 and res["tasks"] >= 3 and res["deals"] >= 5

    statuses = set((await session.execute(select(SalesDocument.status).where(SalesDocument.kind == "quote"))).scalars())
    assert {"sent", "converted"} <= statuses and statuses & {"rejected", "expired", "cancelled"}
    inv = (await session.execute(select(SalesDocument).where(SalesDocument.kind == "invoice"))).scalars().all()
    assert any(d.status == "paid" for d in inv)
    assert any(d.status in ("issued", "partially_paid") and d.due_date < TODAY for d in inv)  # overdue

    tb = await GLService(session).trial_balance(None, None)
    assert tb["balanced"] and tb["total_debit"] > 0

    bank, payables, income, expense = await _figures(session, key)
    assert min(bank) >= 0, bank
    if key in GOODS_CASES:
        assert payables > 0
    assert income > expense, (income, expense)
    assert 10 <= await session.scalar(select(func.count()).select_from(Item)) <= 30
    if key in GOODS_CASES:
        assert await session.scalar(select(func.count()).select_from(ItemPriceBreak).where(ItemPriceBreak.min_qty > 0))
    skus = set((await session.execute(select(Item.sku))).scalars())
    line_skus = set((await session.execute(select(business_demo_line_sku()))).scalars())
    assert line_skus <= skus

    if key in business_demo.P2P_CASES:
        from app.modules.purchasing.models import PurchasingBill, PurchasingOrder

        po_status = sorted((await session.execute(select(PurchasingOrder.status))).scalars())
        assert po_status == ["confirmed", "partially_received", "received", "received"], po_status
        bills = (await session.execute(select(PurchasingBill))).scalars().all()
        assert ("paid", "price_variance") in [(b.status, b.match_status) for b in bills]
        assert sum(b.status == "paid" for b in bills) >= 4
        assert sum(b.status == "posted" and TODAY <= b.due_date <= TODAY + timedelta(days=7) for b in bills) >= 2
        assert sum(b.balance_due for b in bills if b.status == "posted") > 0
        from app.modules.banking.models import BankAccount, BankTransaction
        from app.modules.items.service import ItemsService

        assert await session.scalar(select(func.count()).select_from(BankAccount)) == 1
        assert await session.scalar(select(func.count()).select_from(BankTransaction)) >= 10
        ids = list((await session.execute(select(Item.id).where(Item.stock_tracked.is_(True)))).scalars())
        stock = await ItemsService(session).on_hand(ids)
        assert len(stock) == len(ids) and all(q > 0 for q in stock.values())
        mins = {str(i): m for i, m in (await session.execute(select(Item.id, Item.min_stock).where(Item.id.in_(ids))))}
        assert sum(stock[i] < mins[i] for i in stock) == 2
        from app.modules.inventory.models import StockMovement, Warehouse

        kinds = set((await session.execute(select(StockMovement.kind))).scalars())
        assert {"receipt", "transfer_in", "transfer_out"} <= kinds, kinds
        assert await session.scalar(select(func.count()).select_from(Warehouse)) == 2
    n_docs = await session.scalar(select(func.count()).select_from(SalesDocument))
    n_acc = await session.scalar(select(func.count()).select_from(Account))
    again = await install_business_demo(session, key, owner_id=owner.id, today=TODAY)
    assert again["already_installed"] and await installed_cases(session) == [key]
    assert await session.scalar(select(func.count()).select_from(SalesDocument)) == n_docs
    assert await session.scalar(select(func.count()).select_from(Account)) == n_acc
    assert await session.scalar(select(func.count()).select_from(Opportunity)) == res["deals"]
    assert await session.scalar(select(func.count()).select_from(Task)) == res["tasks"]


async def test_reinstall_replaces_case(session, monkeypatch):
    key = "trade_distribution"
    monkeypatch.setattr(gl_service, "read_business_settings", _settings("DE", "EUR"))
    monkeypatch.setattr(business_demo, "read_business_settings", _settings("DE", "EUR"))
    first = await install_business_demo(session, key, today=TODAY)
    n_docs = await session.scalar(select(func.count()).select_from(SalesDocument))
    again = await reinstall_business_demo(session, key, today=TODAY)
    assert not again["already_installed"] and again["removed"]["sales_documents"] == n_docs
    assert await session.scalar(select(func.count()).select_from(SalesDocument)) == n_docs
    assert await session.scalar(select(func.count()).select_from(Account)) == first["customers"] + first["suppliers"]
    assert await installed_cases(session) == [key]
    assert again["removed"]["p2p_orders"] == 4 and again["p2p_orders"] == 4
    assert again["removed"]["stock_movements"] > 0
    tb = await GLService(session).trial_balance(None, None)
    assert tb["balanced"]


async def test_appointments_seeded_reset_and_stale(session, monkeypatch):
    from app.modules.appointments.models import (
        AppointmentBooking,
        AppointmentResource,
        AppointmentService,
        AppointmentSettings,
    )

    key = "trade_distribution"
    monkeypatch.setattr(gl_service, "read_business_settings", _settings("DE", "EUR"))
    monkeypatch.setattr(business_demo, "read_business_settings", _settings("DE", "EUR"))
    res = await install_business_demo(session, key, today=TODAY)
    assert 15 <= res["appointments"] <= 25, res["appointments"]

    async def count(model):
        return await session.scalar(select(func.count()).select_from(model))

    cfg = business_demo.APPOINTMENT_DEMO[key]
    assert await count(AppointmentResource) == len(cfg["resources"])
    assert await count(AppointmentService) == len(cfg["services"])
    assert await count(AppointmentBooking) == res["appointments"]
    st = (await session.execute(select(AppointmentSettings))).scalar_one()
    assert st.online_enabled and st.public_title == CASES[key].company and st.slug
    rows = (await session.execute(select(AppointmentBooking))).scalars().all()
    assert {"completed", "confirmed", "requested", "cancelled"} <= {b.status for b in rows}
    days = {b.start_at.date() for b in rows}
    assert min(days) >= TODAY - timedelta(days=TODAY.weekday()) and max(days) > TODAY + timedelta(days=6)
    assert all(b.start_at.weekday() < 5 and b.created_by == "business_demo:" + key for b in rows)
    assert all(b.status != "requested" or b.source == "online" for b in rows)

    # No double bookings on one resource.
    live = sorted((b for b in rows if b.status != "cancelled"), key=lambda b: (b.resource_id, b.block_start))
    for a, b in zip(live, live[1:], strict=False):
        assert a.resource_id != b.resource_id or a.block_end <= b.block_start

    # Missing booking page counts as a stale install and is reseeded.
    st.online_enabled = False
    await session.flush()
    again = await install_business_demo(session, key, today=TODAY)
    assert not again["already_installed"] and again["appointments"] == res["appointments"]
    assert await count(AppointmentBooking) == res["appointments"]

    removed = await business_demo.reset_business_demo(session, key)
    assert removed["appointments"] == res["appointments"]
    for model in (AppointmentBooking, AppointmentService, AppointmentResource, AppointmentSettings):
        assert await count(model) == 0
