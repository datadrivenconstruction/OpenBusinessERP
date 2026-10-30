"""Appointments API routes (mounted at /api/v1/appointments).

Staff endpoints are tenant-scoped and permission-gated. ``/public/...`` endpoints need no
login: they resolve the tenant from the booking-page slug, expose only that tenant's online
services and free slot times, never other clients' data, and are rate-limited per client.
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable
from datetime import date, datetime, timedelta
from typing import Annotated, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status

from app.core.rate_limiter import RateLimiter, client_identifier
from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequirePermission, SessionDep
from app.modules.appointments.models import AppointmentService
from app.modules.appointments.schemas import (
    BookingIn,
    BookingResponse,
    BookingUpdate,
    CountResponse,
    ExceptionIn,
    ExceptionResponse,
    HoursIn,
    HoursResponse,
    InvoiceCreated,
    PublicBookingIn,
    PublicBookingResponse,
    PublicBookingView,
    PublicProfile,
    PublicService,
    PublicSlot,
    ReminderDraft,
    ReminderMarkIn,
    ReminderResponse,
    ResourceIn,
    ResourceResponse,
    ResourceUpdate,
    ServiceIn,
    ServiceResponse,
    ServiceUpdate,
    SettingsResponse,
    SettingsUpdate,
    SlotResponse,
    StatusIn,
)
from app.modules.appointments.service import (
    AppointmentsConflictError,
    AppointmentsNotFoundError,
    AppointmentsService,
    AppointmentsValidationError,
    booking_by_token,
    resolve_public,
    utcnow,
)

router = APIRouter(tags=["appointments"])
T = TypeVar("T")

public_read_limiter = RateLimiter(max_requests=60, window_seconds=60)
public_write_limiter = RateLimiter(max_requests=5, window_seconds=600)


def _svc(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> AppointmentsService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return AppointmentsService(session, tenant_id)


Svc = Annotated[AppointmentsService, Depends(_svc)]
Read = Depends(RequirePermission("appointments.read"))
Write = Depends(RequirePermission("appointments.write"))
Manage = Depends(RequirePermission("appointments.manage"))


async def _call[T](aw: Awaitable[T]) -> T:
    try:
        return await aw
    except AppointmentsNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except AppointmentsConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except AppointmentsValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


def _limit(limiter: RateLimiter, request: Request, scope: str) -> None:
    allowed, _ = limiter.is_allowed(f"{client_identifier(request)}:{scope}")
    if not allowed:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Too many requests, please try again later")


# ── Settings ──────────────────────────────────────────────────────────────
@router.get("/settings/", response_model=SettingsResponse)
async def get_settings(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.get_settings()


@router.patch("/settings/", response_model=SettingsResponse)
async def update_settings(body: SettingsUpdate, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    return await _call(svc.update_settings(**body.model_dump(exclude_unset=True)))


@router.post("/settings/regenerate-link/", response_model=SettingsResponse)
async def regenerate_link(_user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    return await svc.regenerate_slug()


# ── Services ──────────────────────────────────────────────────────────────
@router.get("/services/", response_model=list[ServiceResponse])
async def list_services(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.list_services()


@router.post("/services/", response_model=ServiceResponse, status_code=201)
async def create_service(body: ServiceIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.create_service(**body.model_dump()))


@router.patch("/services/{service_id}/", response_model=ServiceResponse)
async def update_service(
    service_id: uuid.UUID, body: ServiceUpdate, _user_id: CurrentUserId, svc: Svc, _perm: None = Write
):
    return await _call(svc.update_service(service_id, **body.model_dump(exclude_unset=True)))


@router.delete("/services/{service_id}/", status_code=204)
async def delete_service(service_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    await _call(svc.delete_service(service_id))
    return Response(status_code=204)


# ── Resources ─────────────────────────────────────────────────────────────
@router.get("/resources/", response_model=list[ResourceResponse])
async def list_resources(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.list_resources()


@router.post("/resources/", response_model=ResourceResponse, status_code=201)
async def create_resource(body: ResourceIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    data = body.model_dump(exclude={"hours"})
    hours = [h.model_dump() for h in body.hours] if body.hours is not None else None
    return await _call(svc.create_resource(hours=hours, **data))


@router.patch("/resources/{resource_id}/", response_model=ResourceResponse)
async def update_resource(
    resource_id: uuid.UUID, body: ResourceUpdate, _user_id: CurrentUserId, svc: Svc, _perm: None = Write
):
    return await _call(svc.update_resource(resource_id, **body.model_dump(exclude_unset=True)))


@router.delete("/resources/{resource_id}/", status_code=204)
async def delete_resource(resource_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    await _call(svc.delete_resource(resource_id))
    return Response(status_code=204)


@router.get("/resources/{resource_id}/hours/", response_model=list[HoursResponse])
async def get_hours(resource_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.get_hours(resource_id))


@router.put("/resources/{resource_id}/hours/", response_model=list[HoursResponse])
async def set_hours(
    resource_id: uuid.UUID, body: list[HoursIn], _user_id: CurrentUserId, svc: Svc, _perm: None = Write
):
    return await _call(svc.set_hours(resource_id, [h.model_dump() for h in body]))


@router.get("/resources/{resource_id}/exceptions/", response_model=list[ExceptionResponse])
async def list_exceptions(resource_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.list_exceptions(resource_id))


@router.post("/resources/{resource_id}/exceptions/", response_model=ExceptionResponse, status_code=201)
async def add_exception(
    resource_id: uuid.UUID, body: ExceptionIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Write
):
    return await _call(svc.add_exception(resource_id, **body.model_dump()))


@router.delete("/exceptions/{exception_id}/", status_code=204)
async def delete_exception(exception_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    await _call(svc.delete_exception(exception_id))
    return Response(status_code=204)


# ── Availability & bookings ───────────────────────────────────────────────
@router.get("/availability/", response_model=list[SlotResponse])
async def availability(
    _user_id: CurrentUserId,
    svc: Svc,
    service_id: uuid.UUID,
    from_date: date | None = None,
    days: int = Query(7, ge=1, le=62),
    resource_id: uuid.UUID | None = None,
    limit: int = Query(50, ge=1, le=500),
    _perm: None = Read,
):
    slots = await _call(
        svc.availability(service_id, from_date or date.today(), days, resource_id, limit, not_before=datetime.now())
    )
    return [SlotResponse(start_at=s, resource_id=r) for s, r in slots]


@router.get("/bookings/", response_model=list[BookingResponse])
async def list_bookings(
    _user_id: CurrentUserId,
    svc: Svc,
    start: datetime | None = None,
    end: datetime | None = None,
    resource_id: uuid.UUID | None = None,
    status_filter: str | None = Query(None, alias="status"),
    _perm: None = Read,
):
    return await svc.list_bookings(start, end, resource_id, status_filter)


@router.post("/bookings/", response_model=list[BookingResponse], status_code=201)
async def create_booking(body: BookingIn, user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.create_booking(**body.model_dump(), source="staff", created_by=str(user_id)))


@router.get("/bookings/{booking_id}/", response_model=BookingResponse)
async def get_booking(booking_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.get_booking(booking_id))


@router.patch("/bookings/{booking_id}/", response_model=BookingResponse)
async def update_booking(
    booking_id: uuid.UUID, body: BookingUpdate, _user_id: CurrentUserId, svc: Svc, _perm: None = Write
):
    return await _call(svc.update_booking(booking_id, **body.model_dump(exclude_unset=True)))


@router.post("/bookings/{booking_id}/status/", response_model=BookingResponse)
async def set_status(booking_id: uuid.UUID, body: StatusIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.set_status(booking_id, body.status))


@router.delete("/bookings/{booking_id}/", status_code=204)
async def delete_booking(booking_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    await _call(svc.delete_booking(booking_id))
    return Response(status_code=204)


@router.post("/bookings/{booking_id}/invoice/", response_model=InvoiceCreated, status_code=201)
async def create_invoice(
    booking_id: uuid.UUID, user_id: CurrentUserId, svc: Svc, _perm: None = Depends(RequirePermission("sales.write"))
):
    doc = await _call(svc.create_invoice(booking_id, created_by=str(user_id)))
    return InvoiceCreated(invoice_id=doc.id, number=doc.number, gross_total=doc.gross_total)


# ── Client data (GDPR) ────────────────────────────────────────────────────
@router.get("/clients/bookings/", response_model=list[BookingResponse])
async def export_client(
    _user_id: CurrentUserId,
    svc: Svc,
    email: str | None = None,
    contact_id: uuid.UUID | None = None,
    _perm: None = Manage,
):
    return await _call(svc.client_bookings(email, contact_id))


@router.delete("/clients/bookings/", response_model=CountResponse)
async def erase_client(
    _user_id: CurrentUserId,
    svc: Svc,
    email: str | None = None,
    contact_id: uuid.UUID | None = None,
    _perm: None = Manage,
):
    return CountResponse(count=await _call(svc.erase_client(email, contact_id)))


@router.post("/retention/purge/", response_model=CountResponse)
async def purge(_user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    return CountResponse(count=await svc.purge_expired())


# ── Reminders outbox ──────────────────────────────────────────────────────
@router.get("/reminders/", response_model=list[ReminderResponse])
async def list_reminders(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.list_reminders()


@router.post("/reminders/prepare/")
async def prepare_reminders(_user_id: CurrentUserId, svc: Svc, _perm: None = Write) -> dict[str, int]:
    return await _call(svc.prepare_due_reminders())


@router.get("/reminders/{reminder_id}/draft/", response_model=ReminderDraft)
async def reminder_draft(reminder_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.reminder_draft(reminder_id))


@router.post("/reminders/{reminder_id}/mark/", response_model=ReminderResponse)
async def mark_reminder(
    reminder_id: uuid.UUID, body: ReminderMarkIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Write
):
    return await _call(svc.mark_reminder(reminder_id, body.status))


@router.post("/bookings/{booking_id}/reminder/", response_model=ReminderResponse, status_code=201)
async def booking_reminder(booking_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.draft_for_booking(booking_id))


# ── Public booking page (no auth) ─────────────────────────────────────────
@router.get("/public/{slug}/", response_model=PublicProfile)
async def public_profile(slug: str, request: Request, session: SessionDep):
    _limit(public_read_limiter, request, "read")
    settings = await _call(resolve_public(session, slug))
    svc = AppointmentsService(session, settings.tenant_id)
    services = [s for s in await svc.list_services(include_inactive=False) if s.online]
    return PublicProfile(
        title=settings.public_title,
        privacy_url=settings.privacy_url,
        max_days_ahead=settings.max_days_ahead,
        services=[
            PublicService(
                id=s.id,
                name=s.name,
                description=s.description,
                duration_min=s.duration_min,
                price=s.price,
                currency=s.currency,
            )
            for s in services
        ],
    )


@router.get("/public/{slug}/slots/", response_model=list[PublicSlot])
async def public_slots(
    slug: str,
    request: Request,
    session: SessionDep,
    service_id: uuid.UUID,
    from_date: date | None = None,
    days: int = Query(7, ge=1, le=31),
):
    _limit(public_read_limiter, request, "read")
    settings = await _call(resolve_public(session, slug))
    svc = AppointmentsService(session, settings.tenant_id)
    today = date.today()
    start = max(from_date or today, today)
    horizon = today + timedelta(days=settings.max_days_ahead)
    if start > horizon:
        return []
    days = min(days, (horizon - start).days + 1)
    not_before = datetime.now() + timedelta(hours=settings.min_notice_hours)
    slots = await _call(
        svc.availability(service_id, start, days, limit=2000, not_before=not_before, services_online_only=True)
    )
    return [PublicSlot(start_at=s) for s in sorted({s for s, _ in slots})]


@router.post("/public/{slug}/bookings/", response_model=PublicBookingResponse, status_code=201)
async def public_book(slug: str, body: PublicBookingIn, request: Request, session: SessionDep):
    _limit(public_write_limiter, request, f"book:{slug}")
    if not body.consent:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Consent to the privacy policy is required")
    if body.website:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "Invalid submission")
    settings = await _call(resolve_public(session, slug))
    svc = AppointmentsService(session, settings.tenant_id)
    start = body.start_at.replace(tzinfo=None, second=0, microsecond=0)
    now = datetime.now()
    if start < now + timedelta(hours=settings.min_notice_hours) or start.date() > (
        now.date() + timedelta(days=settings.max_days_ahead)
    ):
        raise HTTPException(status.HTTP_409_CONFLICT, "This time is no longer available")
    service = await _call(svc.get_service(body.service_id))
    if not (service.online and service.active):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Service not found")
    rows = await _call(
        svc.create_booking(
            service_id=service.id,
            start_at=start,
            client_name=body.name,
            client_email=body.email,
            client_phone=body.phone,
            notes=body.note,
            status="confirmed" if settings.auto_confirm else "requested",
            source="online",
            consent_at=utcnow(),
        )
    )
    b = rows[0]
    return PublicBookingResponse(
        status=b.status, service_name=service.name, start_at=b.start_at, end_at=b.end_at, cancel_token=b.cancel_token
    )


async def _public_view(session: SessionDep, token: str) -> PublicBookingView:
    b = await _call(booking_by_token(session, token))
    service = await session.get(AppointmentService, b.service_id)
    svc = AppointmentsService(session, b.tenant_id)
    settings = await svc.get_settings()
    return PublicBookingView(
        status=b.status,
        service_name=service.name if service else "",
        title=settings.public_title,
        start_at=b.start_at,
        end_at=b.end_at,
        can_cancel=b.status in ("requested", "confirmed") and b.start_at > datetime.now(),
    )


@router.get("/public/booking/{token}/", response_model=PublicBookingView)
async def public_booking(token: str, request: Request, session: SessionDep):
    _limit(public_read_limiter, request, "read")
    return await _public_view(session, token)


@router.post("/public/booking/{token}/cancel/", response_model=PublicBookingView)
async def public_cancel(token: str, request: Request, session: SessionDep):
    _limit(public_write_limiter, request, "cancel")
    b = await _call(booking_by_token(session, token))
    if b.status not in ("requested", "confirmed") or b.start_at <= datetime.now():
        raise HTTPException(status.HTTP_409_CONFLICT, "This booking can no longer be cancelled online")
    await _call(AppointmentsService(session, b.tenant_id).set_status(b.id, "cancelled"))
    return await _public_view(session, token)
