"""Recurring invoices: interval math, idempotent generation, GL posting, pause/resume, auto-send."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import func, select

from app.core.email.memory import MemoryEmailBackend
from app.core.email.service import EmailService
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.recurring.models import RecurringRun
from app.modules.recurring.service import (
    RecurringConflictError,
    RecurringService,
    RecurringValidationError,
    add_months,
    monthly_factor,
    occurrence,
)
from app.modules.sales.models import SalesDocument
from tests._pg import transactional_session

D = Decimal
LINES = [{"description": "Support plan", "qty": "1", "unit_price": "100", "tax_rate": "19"}]


# ── Interval math (no database) ───────────────────────────────────────────
def test_month_end_never_drifts():
    got = [occurrence(date(2026, 1, 31), "monthly", 1, i) for i in range(4)]
    assert got == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


def test_leap_year():
    assert occurrence(date(2024, 2, 29), "yearly", 1, 1) == date(2025, 2, 28)
    assert occurrence(date(2024, 2, 29), "yearly", 1, 4) == date(2028, 2, 29)
    assert occurrence(date(2028, 1, 31), "monthly", 1, 1) == date(2028, 2, 29)


def test_quarterly_weekly_and_counts():
    assert occurrence(date(2026, 11, 30), "quarterly", 1, 1) == date(2027, 2, 28)
    assert occurrence(date(2026, 1, 15), "monthly", 2, 3) == date(2026, 7, 15)
    assert occurrence(date(2026, 12, 28), "weekly", 2, 1) == date(2027, 1, 11)
    assert add_months(date(2026, 12, 15), 1) == date(2027, 1, 15)


def test_day_of_month():
    # Billing day 1 after a mid-month start: first run next month.
    assert occurrence(date(2026, 3, 10), "monthly", 1, 0, 1) == date(2026, 4, 1)
    assert occurrence(date(2026, 1, 5), "monthly", 1, 1, 31) == date(2026, 2, 28)
    assert occurrence(date(2026, 1, 5), "monthly", 1, 2, 31) == date(2026, 3, 31)


def test_monthly_factor():
    assert round(monthly_factor("yearly", 1) * 1200, 6) == 100
    assert round(monthly_factor("quarterly", 1) * 300, 6) == 100
    assert round(monthly_factor("weekly", 1) * 12, 6) == 52


# ── Generation (PostgreSQL) ───────────────────────────────────────────────
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
    return RecurringService(session)


async def _template(svc, **kw):
    data = {"name": "Support", "customer_name": "ACME", "start_date": date(2026, 1, 31), "interval": "monthly"}
    return await svc.create(lines=LINES, **{**data, **kw})


async def _docs(session):
    return (await session.execute(select(SalesDocument).where(SalesDocument.kind == "invoice"))).scalars().all()


async def test_generation_posts_invoice(svc, session):
    t = await _template(svc)
    assert t.next_run_date == date(2026, 1, 31) and t.gross_total == D("119.00")
    res = await svc.generate(t.id)
    assert res.status == "issued"
    (doc,) = await _docs(session)
    assert doc.status == "issued" and doc.gl_entry_id is not None and doc.gross_total == D("119.00")
    assert doc.doc_date == date(2026, 1, 31) and doc.delivery_end == date(2026, 2, 27)
    assert t.next_run_date == date(2026, 2, 28) and t.last_document_id == doc.id and t.generated_count == 1


async def test_run_due_is_idempotent(svc, session):
    t = await _template(svc)
    first = await svc.run_due(date(2026, 3, 31))
    assert [r.period_date for r in first] == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31)]
    again = await svc.run_due(date(2026, 3, 31))
    assert again == []
    assert len(await _docs(session)) == 3
    assert t.next_run_date == date(2026, 4, 30)
    runs = await session.scalar(select(func.count()).select_from(RecurringRun))
    assert runs == 3


async def test_existing_run_is_never_billed_twice(svc, session):
    t = await _template(svc)
    await svc.generate(t.id)
    # Simulate a stale pointer (e.g. a concurrent worker read it before the commit).
    t.period_index, t.next_run_date = 0, date(2026, 1, 31)
    res = await svc.generate(t.id)
    assert res.status == "skipped" and len(await _docs(session)) == 1


async def test_count_limit_ends_and_draft_mode(svc, session):
    t = await _template(svc, max_count=2, auto_issue=False)
    await svc.run_due(date(2026, 12, 31))
    docs = await _docs(session)
    assert len(docs) == 2 and all(d.status == "draft" for d in docs)
    assert t.status == "ended" and t.next_run_date is None
    with pytest.raises(RecurringConflictError):
        await svc.generate(t.id)


async def test_pause_resume_skips_missed_periods(svc, session):
    t = await _template(svc, start_date=date(2026, 1, 15))
    await svc.pause(t.id)
    assert await svc.run_due(date(2026, 6, 1)) == []
    await svc.resume(t.id, today=date(2026, 5, 20))
    assert t.status == "active" and t.next_run_date == date(2026, 6, 15)


async def test_validation(svc):
    with pytest.raises(RecurringValidationError):
        await _template(svc, end_date=date(2025, 1, 1))
    with pytest.raises(RecurringValidationError):
        await svc.create(lines=[], name="x", customer_name="A", start_date=date(2026, 1, 1))


async def test_auto_send_uses_send_pipeline(svc, session, monkeypatch):
    from app.modules.sales.documents import service as docs

    monkeypatch.setattr(docs, "read_business_settings", lambda: {"company_name": "Muster GmbH"})
    monkeypatch.setattr(docs, "read_company_profile", lambda: {})
    backend = MemoryEmailBackend()
    t = await _template(svc, auto_send=True, customer_email="buyer@example.com")
    res = await svc.generate(t.id, email=EmailService(backend))
    assert res.status == "sent" and len(backend.sent) == 1


async def test_tenant_scoping(svc, session):
    t = await _template(svc)
    other = RecurringService(session, "other-tenant")
    assert await other.list_templates() == []
    with pytest.raises(Exception):  # noqa: B017 - not found in the other tenant
        await other.generate(t.id)
