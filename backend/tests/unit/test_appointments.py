"""Appointments: availability, conflicts, public booking, cancellation, reminders, invoicing, tenants."""

from __future__ import annotations

from datetime import date, datetime, timedelta
from decimal import Decimal

import pytest
import pytest_asyncio
from fastapi import HTTPException
from starlette.requests import Request

from app.modules.appointments import router as appt_router
from app.modules.appointments.schemas import PublicBookingIn
from app.modules.appointments.service import (
    AppointmentsConflictError,
    AppointmentsNotFoundError,
    AppointmentsService,
    AppointmentsValidationError,
    rate_from_tax_code,
)
from app.modules.items.models import Item
from app.modules.sales import service as sales_service
from tests._pg import transactional_session

MON = date(2030, 1, 7)  # a Monday
T = "tenant-a"


def at(day: date, hhmm: str) -> datetime:
    h, m = map(int, hhmm.split(":"))
    return datetime(day.year, day.month, day.day, h, m)


def _req(ip: str = "10.0.0.1") -> Request:
    return Request({"type": "http", "client": (ip, 1234), "headers": [], "method": "GET", "path": "/"})


@pytest.fixture(autouse=True)
def _fresh_limits(monkeypatch):
    monkeypatch.setattr(appt_router, "public_read_limiter", appt_router.RateLimiter(1000, 60))
    monkeypatch.setattr(appt_router, "public_write_limiter", appt_router.RateLimiter(1000, 60))
    monkeypatch.setattr(sales_service, "read_business_settings", lambda: {"country_code": "DE"})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


async def _setup(session, tenant: str = T, **svc_kw):
    svc = AppointmentsService(session, tenant)
    await svc.update_settings(max_days_ahead=5000, slot_step_min=15, min_notice_hours=0)
    hours = [
        {"weekday": 0, "start_min": 9 * 60, "end_min": 17 * 60, "kind": "work"},
        {"weekday": 0, "start_min": 12 * 60, "end_min": 13 * 60, "kind": "break"},
    ]
    res = await svc.create_resource(name="Anna", kind="staff", hours=hours)
    kw = {"name": "Consultation", "duration_min": 60, "price": Decimal("80")} | svc_kw
    service = await svc.create_service(**kw)
    return svc, res, service


async def test_availability_respects_hours_breaks_and_buffers(session):
    svc, res, service = await _setup(session, buffer_before_min=15, buffer_after_min=15)
    starts = [s for s, _ in await svc.availability(service.id, MON, 1)]
    assert starts[0] == at(MON, "09:15")  # before-buffer must fit in hours
    assert at(MON, "10:45") in starts and at(MON, "11:00") not in starts  # 11:00+60+15 hits the break
    assert at(MON, "13:15") in starts and at(MON, "13:00") not in starts
    assert starts[-1] == at(MON, "15:45")
    # Tuesday has no hours
    assert await svc.availability(service.id, MON + timedelta(days=1), 1) == []

    await svc.create_booking(service_id=service.id, resource_id=res.id, start_at=at(MON, "14:00"), client_name="X")
    starts = {s for s, _ in await svc.availability(service.id, MON, 1)}
    # Busy block 13:45-15:15 plus our own buffers blocks 12:45..15:30 starts
    assert at(MON, "13:15") not in starts and at(MON, "15:15") not in starts
    assert at(MON, "15:30") in starts


async def test_exceptions_close_and_open(session):
    svc, res, service = await _setup(session)
    await svc.add_exception(res.id, day=MON, kind="closed", label="Holiday")
    assert await svc.availability(service.id, MON, 1) == []
    tue = MON + timedelta(days=1)
    await svc.add_exception(res.id, day=tue, kind="open", start_min=8 * 60, end_min=10 * 60)
    assert [s for s, _ in await svc.availability(service.id, tue, 1)] == [
        at(tue, "08:00"),
        at(tue, "08:15"),
        at(tue, "08:30"),
        at(tue, "08:45"),
        at(tue, "09:00"),
    ]


async def test_conflicting_booking_is_rejected(session):
    svc, res, service = await _setup(session, buffer_after_min=10)
    await svc.create_booking(service_id=service.id, resource_id=res.id, start_at=at(MON, "09:00"), client_name="A")
    with pytest.raises(AppointmentsConflictError):
        await svc.create_booking(service_id=service.id, resource_id=res.id, start_at=at(MON, "10:05"), client_name="B")
    ok = await svc.create_booking(service_id=service.id, resource_id=res.id, start_at=at(MON, "10:10"), client_name="B")
    with pytest.raises(AppointmentsConflictError):
        await svc.update_booking(ok[0].id, start_at=at(MON, "09:30"))
    # A cancelled booking frees the slot.
    first = (await svc.list_bookings())[0]
    await svc.set_status(first.id, "cancelled")
    await svc.update_booking(ok[0].id, start_at=at(MON, "09:30"))


async def test_weekly_series_is_all_or_nothing(session):
    svc, res, service = await _setup(session)
    await svc.create_booking(
        service_id=service.id, resource_id=res.id, start_at=at(MON + timedelta(weeks=2), "09:00"), client_name="Busy"
    )
    with pytest.raises(AppointmentsConflictError):
        await svc.create_booking(
            service_id=service.id, resource_id=res.id, start_at=at(MON, "09:00"), client_name="S", repeat_weeks=3
        )
    rows = await svc.create_booking(
        service_id=service.id, resource_id=res.id, start_at=at(MON, "10:00"), client_name="S", repeat_weeks=3
    )
    assert len(rows) == 4 and len({r.series_id for r in rows}) == 1


async def test_public_booking_happy_path_without_leaks(session):
    svc, res, service = await _setup(session)
    await svc.update_settings(online_enabled=True, public_title="Studio", auto_confirm=False)
    settings = await svc.get_settings()
    await svc.create_booking(
        service_id=service.id,
        resource_id=res.id,
        start_at=at(MON, "09:00"),
        client_name="Secret Person",
        client_email="secret@example.com",
        notes="private",
    )
    profile = await appt_router.public_profile(settings.slug, _req(), session)
    dumped = profile.model_dump_json()
    assert "Secret" not in dumped and "secret@" not in dumped and str(res.id) not in dumped
    slots = await appt_router.public_slots(settings.slug, _req(), session, service_id=service.id, from_date=MON, days=1)
    assert at(MON, "09:00") not in [s.start_at for s in slots]
    assert all(set(s.model_dump()) == {"start_at"} for s in slots)

    body = PublicBookingIn(
        service_id=service.id, start_at=at(MON, "10:00"), name="Eve", email="eve@example.com", consent=True
    )
    resp = await appt_router.public_book(settings.slug, body, _req(), session)
    assert resp.status == "requested" and len(resp.cancel_token) >= 20
    assert set(resp.model_dump()) == {"status", "service_name", "start_at", "end_at", "cancel_token"}
    created = [b for b in await svc.list_bookings() if b.client_name == "Eve"][0]
    assert created.source == "online" and created.consent_at is not None
    # The same slot cannot be taken twice.
    with pytest.raises(HTTPException) as exc:
        await appt_router.public_book(
            settings.slug, body.model_copy(update={"email": "x@example.com"}), _req(), session
        )
    assert exc.value.status_code == 409


async def test_public_booking_requires_consent_and_enabled_page(session):
    svc, _res, service = await _setup(session)
    settings = await svc.get_settings()
    body = PublicBookingIn(
        service_id=service.id, start_at=at(MON, "10:00"), name="Eve", email="eve@example.com", consent=True
    )
    with pytest.raises(HTTPException) as exc:  # page not enabled
        await appt_router.public_book(settings.slug, body, _req(), session)
    assert exc.value.status_code == 404
    await svc.update_settings(online_enabled=True)
    with pytest.raises(HTTPException) as exc:
        await appt_router.public_book(settings.slug, body.model_copy(update={"consent": False}), _req(), session)
    assert exc.value.status_code == 422
    assert await svc.list_bookings() == []


async def test_public_booking_is_rate_limited(session, monkeypatch):
    svc, _res, service = await _setup(session)
    await svc.update_settings(online_enabled=True)
    slug = (await svc.get_settings()).slug
    monkeypatch.setattr(appt_router, "public_read_limiter", appt_router.RateLimiter(2, 60))
    await appt_router.public_profile(slug, _req("10.9.9.9"), session)
    await appt_router.public_profile(slug, _req("10.9.9.9"), session)
    with pytest.raises(HTTPException) as exc:
        await appt_router.public_profile(slug, _req("10.9.9.9"), session)
    assert exc.value.status_code == 429


async def test_cancellation_token(session):
    svc, _res, service = await _setup(session)
    await svc.update_settings(online_enabled=True, auto_confirm=True)
    slug = (await svc.get_settings()).slug
    body = PublicBookingIn(
        service_id=service.id, start_at=at(MON, "10:00"), name="Eve", email="eve@example.com", consent=True
    )
    resp = await appt_router.public_book(slug, body, _req(), session)
    assert resp.status == "confirmed"
    with pytest.raises(HTTPException):
        await appt_router.public_cancel("x" * 40, _req(), session)
    view = await appt_router.public_cancel(resp.cancel_token, _req(), session)
    assert view.status == "cancelled" and not view.can_cancel
    with pytest.raises(HTTPException) as exc:
        await appt_router.public_cancel(resp.cancel_token, _req(), session)
    assert exc.value.status_code == 409


async def test_reminders_are_never_queued_when_disabled(session):
    svc, res, service = await _setup(session)
    await svc.create_booking(
        service_id=service.id,
        resource_id=res.id,
        start_at=at(MON, "09:00"),
        client_name="A",
        client_email="a@example.com",
    )
    assert await svc.list_reminders() == []  # off by default: nothing queued
    assert await svc.prepare_due_reminders(now=at(MON, "08:00")) == {"draft": 0, "skipped": 0}

    await svc.update_settings(reminders_enabled=True, reminder_hours=24)
    b = (
        await svc.create_booking(
            service_id=service.id,
            resource_id=res.id,
            start_at=at(MON, "14:00"),
            client_name="B",
            client_email="b@example.com",
        )
    )[0]
    [rem] = await svc.list_reminders()
    assert rem.due_at == b.start_at - timedelta(hours=24) and rem.status == "queued"
    await svc.update_settings(reminders_enabled=False)
    assert (await svc.prepare_due_reminders(now=at(MON, "08:00")))["draft"] == 0
    assert (await svc.list_reminders())[0].status == "skipped"


async def test_due_reminder_becomes_draft_and_is_never_sent(session, monkeypatch):
    from app.core import email as core_email

    def _boom(*_a, **_k):
        raise AssertionError("appointments must never send mail")

    monkeypatch.setattr(core_email, "get_email_service", _boom, raising=False)
    svc, res, service = await _setup(session)
    await svc.update_settings(reminders_enabled=True, reminder_hours=2, public_title="Studio")
    await svc.create_booking(
        service_id=service.id,
        resource_id=res.id,
        start_at=at(MON, "14:00"),
        client_name="B",
        client_email="b@example.com",
    )
    assert (await svc.prepare_due_reminders(now=at(MON, "11:00")))["draft"] == 0
    assert (await svc.prepare_due_reminders(now=at(MON, "12:30")))["draft"] == 1
    [rem] = await svc.list_reminders()
    assert rem.status == "draft"
    draft = await svc.reminder_draft(rem.id)
    assert draft["recipient"] == "b@example.com" and "Consultation" in draft["subject"]
    assert "Studio" in draft["body"] and "<" not in draft["body"]
    assert (await svc.mark_reminder(rem.id, "sent")).status == "sent"
    with pytest.raises(AppointmentsValidationError):
        await svc.mark_reminder(rem.id, "skipped")


async def test_on_demand_reminder_draft_is_reused_and_tenant_scoped(session):
    svc, res, service = await _setup(session)
    b = (
        await svc.create_booking(
            service_id=service.id,
            resource_id=res.id,
            start_at=at(MON, "10:00"),
            client_name="C",
            client_email="c@example.com",
        )
    )[0]
    first = await svc.draft_for_booking(b.id)
    again = await svc.draft_for_booking(b.id)
    assert first.id == again.id and first.status == "draft"
    with pytest.raises(AppointmentsValidationError):
        await svc.mark_reminder(first.id, "queued")
    other = AppointmentsService(session, "tenant-b")
    with pytest.raises(AppointmentsNotFoundError):
        await other.reminder_draft(first.id)
    no_mail = (
        await svc.create_booking(service_id=service.id, resource_id=res.id, start_at=at(MON, "14:00"), client_name="D")
    )[0]
    with pytest.raises(AppointmentsValidationError):
        await svc.draft_for_booking(no_mail.id)


async def test_invoice_from_completed_booking_uses_item_tax_code(session):
    item = Item(
        tenant_id=T, sku="TRT-1", name="Treatment", item_type="service", sales_price=Decimal("90"), tax_code="EXEMPT"
    )
    session.add(item)
    await session.flush()
    svc, res, service = await _setup(session, item_id=item.id, price=Decimal("0"))
    b = (
        await svc.create_booking(
            service_id=service.id, resource_id=res.id, start_at=at(MON, "09:00"), client_name="Pat"
        )
    )[0]
    with pytest.raises(AppointmentsConflictError):
        await svc.create_invoice(b.id)
    await svc.set_status(b.id, "checked_in")
    await svc.set_status(b.id, "completed")
    doc = await svc.create_invoice(b.id)
    assert doc.kind == "invoice" and doc.customer_name == "Pat"
    assert doc.net_total == Decimal("90.00") and doc.tax_total == Decimal("0.00")
    assert doc.lines[0].sku == "TRT-1"
    with pytest.raises(AppointmentsConflictError):
        await svc.create_invoice(b.id)


def test_rate_from_tax_code():
    assert rate_from_tax_code("19") == Decimal("19")
    assert rate_from_tax_code("exempt") == Decimal(0)
    assert rate_from_tax_code("") is None and rate_from_tax_code("VAT_STD") is None


async def test_tenant_isolation(session):
    svc_a, res_a, service_a = await _setup(session, tenant="tenant-a")
    b = (
        await svc_a.create_booking(
            service_id=service_a.id,
            resource_id=res_a.id,
            start_at=at(MON, "09:00"),
            client_name="A",
            client_email="a@example.com",
        )
    )[0]
    svc_b = AppointmentsService(session, "tenant-b")
    assert await svc_b.list_bookings() == [] and await svc_b.list_services() == []
    with pytest.raises(AppointmentsNotFoundError):
        await svc_b.get_booking(b.id)
    with pytest.raises(AppointmentsNotFoundError):
        await svc_b.availability(service_a.id, MON, 1)
    assert await svc_b.client_bookings("a@example.com", None) == []
    assert await svc_b.erase_client("a@example.com", None) == 0
    assert len(await svc_a.client_bookings("a@example.com", None)) == 1


async def test_client_export_erase_and_retention(session):
    svc, res, service = await _setup(session)
    await svc.create_booking(
        service_id=service.id,
        resource_id=res.id,
        start_at=at(MON, "09:00"),
        client_name="A",
        client_email="a@example.com",
    )
    await svc.create_booking(
        service_id=service.id,
        resource_id=res.id,
        start_at=at(MON, "10:00"),
        client_name="B",
        client_email="b@example.com",
    )
    assert await svc.erase_client("a@example.com", None) == 1
    assert [b.client_name for b in await svc.list_bookings()] == ["B"]
    assert await svc.purge_expired(now=at(MON, "12:00") + timedelta(days=400)) == 0  # retention off
    await svc.update_settings(retention_days=365)
    assert await svc.purge_expired(now=at(MON, "12:00") + timedelta(days=400)) == 1
