"""Appointments business logic: availability, conflicts, bookings, online booking, reminders, invoicing."""

from __future__ import annotations

import re
import secrets
import uuid
from collections.abc import Iterable
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.appointments.models import (
    RESOURCE_KINDS,
    STATUSES,
    AppointmentBooking,
    AppointmentException,
    AppointmentHours,
    AppointmentReminder,
    AppointmentResource,
    AppointmentService,
    AppointmentSettings,
)

# Statuses that no longer hold the slot.
FREEING = {"cancelled"}
TRANSITIONS: dict[str, set[str]] = {
    "requested": {"confirmed", "cancelled"},
    "confirmed": {"checked_in", "completed", "no_show", "cancelled", "requested"},
    "checked_in": {"completed", "no_show", "confirmed"},
    "completed": set(),
    "no_show": {"confirmed"},
    "cancelled": set(),
}
TERMINAL = {"completed", "no_show", "cancelled"}
Interval = tuple[int, int]


class AppointmentsError(Exception):
    pass


class AppointmentsNotFoundError(AppointmentsError):
    pass


class AppointmentsValidationError(AppointmentsError):
    pass


class AppointmentsConflictError(AppointmentsError):
    pass


# ── Pure availability helpers ─────────────────────────────────────────────
def subtract(windows: Iterable[Interval], cut: Interval) -> list[Interval]:
    out: list[Interval] = []
    cs, ce = cut
    for s, e in windows:
        if ce <= s or cs >= e:
            out.append((s, e))
            continue
        if cs > s:
            out.append((s, cs))
        if ce < e:
            out.append((ce, e))
    return out


def day_windows(
    weekday: int,
    hours: Iterable[AppointmentHours],
    exceptions: Iterable[AppointmentException],
) -> list[Interval]:
    """Working windows (minutes after midnight) for one resource on one day."""
    hours = list(hours)
    windows = sorted((h.start_min, h.end_min) for h in hours if h.weekday == weekday and h.kind == "work")
    for h in hours:
        if h.weekday == weekday and h.kind == "break":
            windows = subtract(windows, (h.start_min, h.end_min))
    for ex in exceptions:
        if ex.kind == "closed":
            if ex.start_min is None or ex.end_min is None:
                return []
            windows = subtract(windows, (ex.start_min, ex.end_min))
        elif ex.kind == "open" and ex.start_min is not None and ex.end_min is not None:
            windows = sorted([*subtract(windows, (ex.start_min, ex.end_min)), (ex.start_min, ex.end_min)])
    return [w for w in windows if w[1] > w[0]]


def free_slots(
    day: date,
    windows: list[Interval],
    busy: list[tuple[datetime, datetime]],
    duration: int,
    buffer_before: int,
    buffer_after: int,
    step: int,
    not_before: datetime | None = None,
) -> list[datetime]:
    """Slot starts whose buffered block fits a working window and overlaps no busy block."""
    midnight = datetime.combine(day, time())
    step = max(5, step)
    out: list[datetime] = []
    for ws, we in windows:
        first = ws + buffer_before
        s = -(-first // step) * step
        while s - buffer_before >= ws and s + duration + buffer_after <= we:
            start = midnight + timedelta(minutes=s)
            bs = start - timedelta(minutes=buffer_before)
            be = start + timedelta(minutes=duration + buffer_after)
            if (not_before is None or start >= not_before) and not any(b0 < be and bs < b1 for b0, b1 in busy):
                out.append(start)
            s += step
    return out


def rate_from_tax_code(code: str | None) -> Decimal | None:
    """Tax rate for an item tax code: a number is a percentage, exempt codes are 0, else company default."""
    raw = (code or "").strip().upper().rstrip("%")
    if not raw:
        return None
    if raw in {"EXEMPT", "EX", "E", "FREE", "ZERO", "MED", "MEDICAL", "NONE", "0"}:
        return Decimal(0)
    try:
        value = Decimal(raw.replace(",", "."))
    except InvalidOperation:
        return None
    return value if Decimal(0) <= value <= Decimal(100) else None


def _slugify(text: str) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:40]
    return f"{base or 'book'}-{secrets.token_hex(4)}"


# ── Reminders ─────────────────────────────────────────────────────────────
# Reminders are drafts only: the module never sends mail or SMS by itself. Staff
# review a prepared draft, send it from their own mail client and mark it sent.
REMINDER_STATUSES: tuple[str, ...] = ("queued", "draft", "sent", "skipped")


# ── Service ───────────────────────────────────────────────────────────────
class AppointmentsService:
    def __init__(self, session: AsyncSession, tenant_id: str) -> None:
        self.session = session
        self.tenant_id = tenant_id

    # Settings
    async def get_settings(self) -> AppointmentSettings:
        row = await self.session.scalar(
            select(AppointmentSettings).where(AppointmentSettings.tenant_id == self.tenant_id)
        )
        if row is None:
            row = AppointmentSettings(
                tenant_id=self.tenant_id,
                slug=_slugify(""),
                public_title="",
                online_enabled=False,
                auto_confirm=False,
                privacy_url="",
                slot_step_min=15,
                min_notice_hours=2,
                max_days_ahead=60,
                retention_days=0,
                reminders_enabled=False,
                reminder_hours=24,
                timezone="Europe/Berlin",
            )
            self.session.add(row)
            await self.session.flush()
        return row

    async def update_settings(self, **data: Any) -> AppointmentSettings:
        row = await self.get_settings()
        for k, v in data.items():
            if v is not None and hasattr(row, k) and k not in {"id", "tenant_id", "slug"}:
                setattr(row, k, v)
        if data.get("public_title") and row.slug.startswith("book-"):
            row.slug = _slugify(row.public_title)
        if data.get("reminders_enabled") is False:
            await self._skip_queued(None, "reminders disabled")
        await self.session.flush()
        return row

    async def regenerate_slug(self) -> AppointmentSettings:
        row = await self.get_settings()
        row.slug = _slugify(row.public_title)
        await self.session.flush()
        return row

    # Services
    async def list_services(self, include_inactive: bool = True) -> list[AppointmentService]:
        q = select(AppointmentService).where(AppointmentService.tenant_id == self.tenant_id)
        if not include_inactive:
            q = q.where(AppointmentService.active.is_(True))
        return list((await self.session.execute(q.order_by(AppointmentService.name))).scalars())

    async def get_service(self, service_id: uuid.UUID) -> AppointmentService:
        row = await self.session.get(AppointmentService, service_id)
        if row is None or row.tenant_id != self.tenant_id:
            raise AppointmentsNotFoundError("Service not found")
        return row

    async def _check_service(self, data: dict[str, Any]) -> None:
        if "resource_kind" in data and data["resource_kind"] not in RESOURCE_KINDS:
            raise AppointmentsValidationError("Unknown resource type")
        if data.get("item_id"):
            from app.modules.items.models import Item

            item = await self.session.get(Item, data["item_id"])
            if item is None or (item.tenant_id not in (None, self.tenant_id)):
                raise AppointmentsValidationError("Catalogue item not found")
        if "resource_ids" in data and data["resource_ids"] is not None:
            data["resource_ids"] = [str(r) for r in data["resource_ids"]]

    async def create_service(self, **data: Any) -> AppointmentService:
        await self._check_service(data)
        data.setdefault("resource_ids", [])
        row = AppointmentService(tenant_id=self.tenant_id, **data)
        self.session.add(row)
        await self.session.flush()
        return row

    async def update_service(self, service_id: uuid.UUID, **data: Any) -> AppointmentService:
        row = await self.get_service(service_id)
        await self._check_service(data)
        for k, v in data.items():
            setattr(row, k, v)
        await self.session.flush()
        return row

    async def delete_service(self, service_id: uuid.UUID) -> None:
        row = await self.get_service(service_id)
        used = await self.session.scalar(
            select(AppointmentBooking.id).where(AppointmentBooking.service_id == row.id).limit(1)
        )
        if used:
            row.active = False  # keep history; bookings reference it
        else:
            await self.session.delete(row)
        await self.session.flush()

    # Resources
    async def list_resources(self) -> list[AppointmentResource]:
        q = select(AppointmentResource).where(AppointmentResource.tenant_id == self.tenant_id)
        return list(
            (await self.session.execute(q.order_by(AppointmentResource.sort_order, AppointmentResource.name))).scalars()
        )

    async def get_resource(self, resource_id: uuid.UUID) -> AppointmentResource:
        row = await self.session.get(AppointmentResource, resource_id)
        if row is None or row.tenant_id != self.tenant_id:
            raise AppointmentsNotFoundError("Resource not found")
        return row

    async def create_resource(self, hours: list[dict[str, Any]] | None = None, **data: Any) -> AppointmentResource:
        if data.get("kind", "staff") not in RESOURCE_KINDS:
            raise AppointmentsValidationError("Unknown resource type")
        row = AppointmentResource(tenant_id=self.tenant_id, **data)
        self.session.add(row)
        await self.session.flush()
        if hours is not None:
            await self.set_hours(row.id, hours)
        return row

    async def update_resource(self, resource_id: uuid.UUID, **data: Any) -> AppointmentResource:
        row = await self.get_resource(resource_id)
        if "kind" in data and data["kind"] not in RESOURCE_KINDS:
            raise AppointmentsValidationError("Unknown resource type")
        for k, v in data.items():
            setattr(row, k, v)
        await self.session.flush()
        return row

    async def delete_resource(self, resource_id: uuid.UUID) -> None:
        row = await self.get_resource(resource_id)
        used = await self.session.scalar(
            select(AppointmentBooking.id).where(AppointmentBooking.resource_id == row.id).limit(1)
        )
        if used:
            row.active = False
        else:
            await self.session.delete(row)
        await self.session.flush()

    async def get_hours(self, resource_id: uuid.UUID) -> list[AppointmentHours]:
        await self.get_resource(resource_id)
        q = select(AppointmentHours).where(AppointmentHours.resource_id == resource_id)
        return list(
            (await self.session.execute(q.order_by(AppointmentHours.weekday, AppointmentHours.start_min))).scalars()
        )

    async def set_hours(self, resource_id: uuid.UUID, hours: list[dict[str, Any]]) -> list[AppointmentHours]:
        await self.get_resource(resource_id)
        for h in hours:
            if not (0 <= h["weekday"] <= 6 and 0 <= h["start_min"] < h["end_min"] <= 1440):
                raise AppointmentsValidationError("Invalid working hours")
            if h.get("kind", "work") not in ("work", "break"):
                raise AppointmentsValidationError("Hours kind must be work or break")
        await self.session.execute(delete(AppointmentHours).where(AppointmentHours.resource_id == resource_id))
        rows = [
            AppointmentHours(
                resource_id=resource_id,
                kind=h.get("kind", "work"),
                weekday=h["weekday"],
                start_min=h["start_min"],
                end_min=h["end_min"],
            )
            for h in hours
        ]
        self.session.add_all(rows)
        await self.session.flush()
        return rows

    async def list_exceptions(self, resource_id: uuid.UUID) -> list[AppointmentException]:
        await self.get_resource(resource_id)
        q = select(AppointmentException).where(AppointmentException.resource_id == resource_id)
        return list((await self.session.execute(q.order_by(AppointmentException.day))).scalars())

    async def add_exception(self, resource_id: uuid.UUID, **data: Any) -> AppointmentException:
        await self.get_resource(resource_id)
        if data.get("kind", "closed") not in ("closed", "open"):
            raise AppointmentsValidationError("Exception kind must be closed or open")
        s, e = data.get("start_min"), data.get("end_min")
        if (s is None) != (e is None) or (s is not None and not 0 <= s < e <= 1440):
            raise AppointmentsValidationError("Invalid exception times")
        if data.get("kind") == "open" and s is None:
            raise AppointmentsValidationError("Extra opening needs start and end")
        row = AppointmentException(resource_id=resource_id, **data)
        self.session.add(row)
        await self.session.flush()
        return row

    async def delete_exception(self, exception_id: uuid.UUID) -> None:
        row = await self.session.get(AppointmentException, exception_id)
        if row is None:
            raise AppointmentsNotFoundError("Exception not found")
        await self.get_resource(row.resource_id)
        await self.session.delete(row)
        await self.session.flush()

    # Availability
    async def _candidates(self, svc: AppointmentService, resource_id: uuid.UUID | None) -> list[AppointmentResource]:
        resources = [r for r in await self.list_resources() if r.active and r.kind == svc.resource_kind]
        if svc.resource_ids:
            allowed = {str(r) for r in svc.resource_ids}
            resources = [r for r in resources if str(r.id) in allowed]
        if resource_id is not None:
            resources = [r for r in resources if r.id == resource_id]
        return resources

    async def _busy(
        self, resource_id: uuid.UUID, start: datetime, end: datetime, exclude: set[uuid.UUID] | None = None
    ) -> list[tuple[datetime, datetime]]:
        q = select(AppointmentBooking.id, AppointmentBooking.block_start, AppointmentBooking.block_end).where(
            AppointmentBooking.tenant_id == self.tenant_id,
            AppointmentBooking.resource_id == resource_id,
            AppointmentBooking.status.notin_(FREEING),
            AppointmentBooking.block_start < end,
            AppointmentBooking.block_end > start,
        )
        return [(bs, be) for bid, bs, be in (await self.session.execute(q)).all() if not exclude or bid not in exclude]

    async def availability(
        self,
        service_id: uuid.UUID,
        from_date: date,
        days: int = 7,
        resource_id: uuid.UUID | None = None,
        limit: int = 200,
        not_before: datetime | None = None,
        services_online_only: bool = False,
    ) -> list[tuple[datetime, uuid.UUID]]:
        svc = await self.get_service(service_id)
        if not svc.active or (services_online_only and not svc.online):
            raise AppointmentsNotFoundError("Service not found")
        settings = await self.get_settings()
        days = max(1, min(days, 62))
        out: list[tuple[datetime, uuid.UUID]] = []
        range_start = datetime.combine(from_date, time())
        range_end = range_start + timedelta(days=days + 1)
        for res in await self._candidates(svc, resource_id):
            hours = await self.get_hours(res.id)
            exceptions = [
                e for e in await self.list_exceptions(res.id) if from_date <= e.day < from_date + timedelta(days=days)
            ]
            busy = await self._busy(res.id, range_start - timedelta(days=1), range_end)
            for i in range(days):
                day = from_date + timedelta(days=i)
                windows = day_windows(day.weekday(), hours, [e for e in exceptions if e.day == day])
                for s in free_slots(
                    day,
                    windows,
                    busy,
                    svc.duration_min,
                    svc.buffer_before_min,
                    svc.buffer_after_min,
                    settings.slot_step_min,
                    not_before,
                ):
                    out.append((s, res.id))
        out.sort(key=lambda x: (x[0], str(x[1])))
        return out[:limit]

    # Bookings
    async def get_booking(self, booking_id: uuid.UUID) -> AppointmentBooking:
        row = await self.session.get(AppointmentBooking, booking_id)
        if row is None or row.tenant_id != self.tenant_id:
            raise AppointmentsNotFoundError("Booking not found")
        return row

    async def list_bookings(
        self,
        start: datetime | None = None,
        end: datetime | None = None,
        resource_id: uuid.UUID | None = None,
        status: str | None = None,
        limit: int = 1000,
    ) -> list[AppointmentBooking]:
        q = select(AppointmentBooking).where(AppointmentBooking.tenant_id == self.tenant_id)
        if start:
            q = q.where(AppointmentBooking.end_at > start)
        if end:
            q = q.where(AppointmentBooking.start_at < end)
        if resource_id:
            q = q.where(AppointmentBooking.resource_id == resource_id)
        if status:
            q = q.where(AppointmentBooking.status == status)
        return list((await self.session.execute(q.order_by(AppointmentBooking.start_at).limit(limit))).scalars())

    @staticmethod
    def _blocks(svc: AppointmentService, start: datetime, end: datetime) -> tuple[datetime, datetime]:
        return start - timedelta(minutes=svc.buffer_before_min), end + timedelta(minutes=svc.buffer_after_min)

    async def _assert_free(
        self, resource_id: uuid.UUID, bs: datetime, be: datetime, exclude: set[uuid.UUID] | None = None
    ) -> None:
        if await self._busy(resource_id, bs, be, exclude):
            raise AppointmentsConflictError("The resource is already booked at this time")

    async def _resolve_contact(self, contact_id: uuid.UUID, user_id: str | None) -> Any:
        from app.modules.contacts.models import Contact

        contact = await self.session.get(Contact, contact_id)
        if contact is None or not (
            contact.tenant_id in (None, self.tenant_id) or (user_id and contact.created_by == user_id)
        ):
            raise AppointmentsValidationError("Contact not found")
        return contact

    async def _new_contact(self, name: str, email: str, phone: str, user_id: str | None) -> uuid.UUID:
        from app.modules.contacts.models import Contact

        first, _, last = (name or "").strip().partition(" ")
        contact = Contact(
            contact_type="client",
            first_name=first or None,
            last_name=last or None,
            primary_email=email or None,
            primary_phone=phone or None,
            tenant_id=self.tenant_id,
            created_by=user_id,
        )
        self.session.add(contact)
        await self.session.flush()
        return contact.id

    async def create_booking(
        self,
        *,
        service_id: uuid.UUID,
        start_at: datetime,
        resource_id: uuid.UUID | None = None,
        contact_id: uuid.UUID | None = None,
        create_contact: bool = False,
        client_name: str = "",
        client_email: str = "",
        client_phone: str = "",
        notes: str = "",
        status: str = "confirmed",
        source: str = "staff",
        repeat_weeks: int = 0,
        consent_at: datetime | None = None,
        created_by: str | None = None,
        require_free_slot: bool = False,
    ) -> list[AppointmentBooking]:
        svc = await self.get_service(service_id)
        if not svc.active:
            raise AppointmentsValidationError("Service is inactive")
        if status not in ("requested", "confirmed"):
            raise AppointmentsValidationError("A new booking is requested or confirmed")
        start_at = start_at.replace(tzinfo=None, second=0, microsecond=0)
        if resource_id is None:
            free = await self.availability(service_id, start_at.date(), 1, not_before=start_at)
            match = [rid for s, rid in free if s == start_at]
            if not match:
                raise AppointmentsConflictError("No resource is free at this time")
            resource_id = match[0]
        res = await self.get_resource(resource_id)
        if res.kind != svc.resource_kind:
            raise AppointmentsValidationError("Resource type does not match the service")
        if require_free_slot:
            free = await self.availability(service_id, start_at.date(), 1, resource_id=resource_id)
            if start_at not in {s for s, _ in free}:
                raise AppointmentsConflictError("This time is no longer available")
        if contact_id is not None:
            contact = await self._resolve_contact(contact_id, created_by)
            if not client_name:
                client_name = (contact.company_name or f"{contact.first_name or ''} {contact.last_name or ''}").strip()
            client_email = client_email or contact.primary_email or ""
            client_phone = client_phone or contact.primary_phone or ""
        elif create_contact and client_name:
            contact_id = await self._new_contact(client_name, client_email, client_phone, created_by)
        if not client_name.strip():
            raise AppointmentsValidationError("Client name is required")
        repeat_weeks = max(0, min(repeat_weeks, 52))
        series_id = uuid.uuid4() if repeat_weeks else None
        occurrences = []
        for k in range(repeat_weeks + 1):
            s = start_at + timedelta(weeks=k)
            e = s + timedelta(minutes=svc.duration_min)
            bs, be = self._blocks(svc, s, e)
            await self._assert_free(resource_id, bs, be)  # check every week before writing any
            occurrences.append((s, e, bs, be))
        rows: list[AppointmentBooking] = []
        for s, e, bs, be in occurrences:
            row = AppointmentBooking(
                tenant_id=self.tenant_id,
                service_id=svc.id,
                resource_id=resource_id,
                contact_id=contact_id,
                client_name=client_name.strip(),
                client_email=(client_email or "").strip(),
                client_phone=(client_phone or "").strip(),
                start_at=s,
                end_at=e,
                block_start=bs,
                block_end=be,
                status=status,
                source=source,
                notes=notes or "",
                cancel_token=secrets.token_urlsafe(32),
                consent_at=consent_at,
                series_id=series_id,
                created_by=created_by,
            )
            self.session.add(row)
            await self.session.flush()
            rows.append(row)
            if status == "confirmed":
                await self._queue_reminder(row)
        return rows

    async def update_booking(self, booking_id: uuid.UUID, **data: Any) -> AppointmentBooking:
        row = await self.get_booking(booking_id)
        if row.status in TERMINAL and ({"start_at", "resource_id", "service_id"} & data.keys()):
            raise AppointmentsConflictError("A closed booking cannot be moved")
        svc = await self.get_service(data.get("service_id") or row.service_id)
        start = (data.get("start_at") or row.start_at).replace(tzinfo=None, second=0, microsecond=0)
        resource_id = data.get("resource_id") or row.resource_id
        if resource_id != row.resource_id:
            res = await self.get_resource(resource_id)
            if res.kind != svc.resource_kind:
                raise AppointmentsValidationError("Resource type does not match the service")
        end = start + timedelta(minutes=svc.duration_min)
        bs, be = self._blocks(svc, start, end)
        if (start, resource_id, svc.id) != (row.start_at, row.resource_id, row.service_id):
            await self._assert_free(resource_id, bs, be, exclude={row.id})
        row.service_id, row.resource_id = svc.id, resource_id
        row.start_at, row.end_at, row.block_start, row.block_end = start, end, bs, be
        for k in ("client_name", "client_email", "client_phone", "notes", "contact_id"):
            if k in data and data[k] is not None:
                setattr(row, k, data[k])
        await self.session.flush()
        await self._reschedule_reminder(row)
        return row

    async def set_status(self, booking_id: uuid.UUID, target: str) -> AppointmentBooking:
        if target not in STATUSES:
            raise AppointmentsValidationError("Unknown status")
        row = await self.get_booking(booking_id)
        if target == row.status:
            return row
        if target not in TRANSITIONS[row.status]:
            raise AppointmentsConflictError(f"Cannot go from {row.status} to {target}")
        if row.status == "cancelled" or (row.status == "no_show" and target == "confirmed"):
            await self._assert_free(row.resource_id, row.block_start, row.block_end, exclude={row.id})
        row.status = target
        await self.session.flush()
        if target == "confirmed":
            await self._queue_reminder(row)
        elif target in TERMINAL:
            await self._skip_queued(row.id, f"booking {target}")
        return row

    async def delete_booking(self, booking_id: uuid.UUID) -> None:
        row = await self.get_booking(booking_id)
        await self.session.delete(row)
        await self.session.flush()

    # Invoicing
    async def create_invoice(self, booking_id: uuid.UUID, created_by: str | None = None) -> Any:
        from app.modules.sales.service import LineData, SalesService

        row = await self.get_booking(booking_id)
        if row.status != "completed":
            raise AppointmentsConflictError("Only a completed booking can be invoiced")
        if row.invoice_id is not None:
            raise AppointmentsConflictError("This booking is already invoiced")
        svc = await self.get_service(row.service_id)
        sku, price, tax_rate, description = "", svc.price, None, svc.name
        if svc.item_id is not None:
            from app.modules.items.models import Item

            item = await self.session.get(Item, svc.item_id)
            if item is not None:
                sku, tax_rate = item.sku, rate_from_tax_code(item.tax_code)
                if not price:
                    price = item.sales_price
        line = LineData(
            description=f"{description} - {row.start_at:%Y-%m-%d %H:%M}",
            sku=sku,
            qty=Decimal(1),
            unit_price=Decimal(str(price or 0)),
            tax_rate=tax_rate,
        )
        doc = await SalesService(self.session, self.tenant_id).create(
            "invoice",
            lines=[line],
            customer_id=row.contact_id,
            customer_name=row.client_name,
            currency=svc.currency,
            created_by=created_by,
            notes=f"Appointment {row.id}",
        )
        row.invoice_id = doc.id
        await self.session.flush()
        return doc

    # GDPR
    def _client_filter(self, email: str | None, contact_id: uuid.UUID | None) -> Any:
        conds = []
        if email:
            conds.append(AppointmentBooking.client_email == email.strip())
        if contact_id:
            conds.append(AppointmentBooking.contact_id == contact_id)
        if not conds:
            raise AppointmentsValidationError("Give an email or a contact")
        return or_(*conds)

    async def client_bookings(self, email: str | None, contact_id: uuid.UUID | None) -> list[AppointmentBooking]:
        q = select(AppointmentBooking).where(
            AppointmentBooking.tenant_id == self.tenant_id, self._client_filter(email, contact_id)
        )
        return list((await self.session.execute(q.order_by(AppointmentBooking.start_at))).scalars())

    async def erase_client(self, email: str | None, contact_id: uuid.UUID | None) -> int:
        rows = await self.client_bookings(email, contact_id)
        for r in rows:
            await self.session.delete(r)
        await self.session.flush()
        return len(rows)

    async def purge_expired(self, now: datetime | None = None) -> int:
        settings = await self.get_settings()
        if settings.retention_days <= 0:
            return 0
        cutoff = (now or datetime.now()) - timedelta(days=settings.retention_days)
        q = select(AppointmentBooking).where(
            AppointmentBooking.tenant_id == self.tenant_id, AppointmentBooking.end_at < cutoff
        )
        rows = list((await self.session.execute(q)).scalars())
        for r in rows:
            await self.session.delete(r)
        await self.session.flush()
        return len(rows)

    # Reminders (outbox)
    async def _queue_reminder(self, row: AppointmentBooking) -> None:
        settings = await self.get_settings()
        if not settings.reminders_enabled or not row.client_email:
            return
        due = row.start_at - timedelta(hours=settings.reminder_hours)
        if row.start_at <= datetime.now():
            return
        existing = await self.session.scalar(
            select(AppointmentReminder).where(
                AppointmentReminder.booking_id == row.id, AppointmentReminder.status == "queued"
            )
        )
        if existing is not None:
            existing.due_at, existing.recipient = due, row.client_email
        else:
            self.session.add(
                AppointmentReminder(
                    tenant_id=self.tenant_id,
                    booking_id=row.id,
                    channel="email",
                    recipient=row.client_email,
                    due_at=due,
                    status="queued",
                    detail="",
                )
            )
        await self.session.flush()

    async def _reschedule_reminder(self, row: AppointmentBooking) -> None:
        if row.status == "confirmed":
            await self._queue_reminder(row)

    async def _skip_queued(self, booking_id: uuid.UUID | None, reason: str) -> None:
        q = select(AppointmentReminder).where(
            AppointmentReminder.tenant_id == self.tenant_id, AppointmentReminder.status == "queued"
        )
        if booking_id is not None:
            q = q.where(AppointmentReminder.booking_id == booking_id)
        for r in (await self.session.execute(q)).scalars():
            r.status, r.detail = "skipped", reason
        await self.session.flush()

    async def list_reminders(self, limit: int = 200) -> list[AppointmentReminder]:
        q = select(AppointmentReminder).where(AppointmentReminder.tenant_id == self.tenant_id)
        return list((await self.session.execute(q.order_by(AppointmentReminder.due_at.desc()).limit(limit))).scalars())

    async def get_reminder(self, reminder_id: uuid.UUID) -> AppointmentReminder:
        row = await self.session.get(AppointmentReminder, reminder_id)
        if row is None or row.tenant_id != self.tenant_id:
            raise AppointmentsNotFoundError("Reminder not found")
        return row

    async def prepare_due_reminders(self, now: datetime | None = None) -> dict[str, int]:
        """Turn due queued reminders into drafts for staff to review. Never sends anything."""
        counts = {"draft": 0, "skipped": 0}
        settings = await self.get_settings()
        now = now or datetime.now()
        q = select(AppointmentReminder).where(
            AppointmentReminder.tenant_id == self.tenant_id,
            AppointmentReminder.status == "queued",
            AppointmentReminder.due_at <= now,
        )
        for rem in list((await self.session.execute(q)).scalars()):
            booking = await self.session.get(AppointmentBooking, rem.booking_id)
            if not settings.reminders_enabled:
                rem.status, rem.detail = "skipped", "reminders disabled"
            elif booking is None or booking.status != "confirmed" or booking.start_at <= now:
                rem.status, rem.detail = "skipped", "booking no longer upcoming"
            else:
                rem.status, rem.detail = "draft", ""
            counts[rem.status] += 1
        await self.session.flush()
        return counts

    async def draft_for_booking(self, booking_id: uuid.UUID) -> AppointmentReminder:
        """Create (or reuse) a reminder draft for one booking on demand."""
        booking = await self.get_booking(booking_id)
        if booking.status not in ("requested", "confirmed"):
            raise AppointmentsValidationError("Only upcoming bookings can get a reminder")
        if not booking.client_email:
            raise AppointmentsValidationError("The booking has no email address")
        existing = await self.session.scalar(
            select(AppointmentReminder).where(
                AppointmentReminder.booking_id == booking.id, AppointmentReminder.status.in_(("queued", "draft"))
            )
        )
        if existing is not None:
            existing.status, existing.recipient = "draft", booking.client_email
            await self.session.flush()
            return existing
        row = AppointmentReminder(
            tenant_id=self.tenant_id,
            booking_id=booking.id,
            channel="email",
            recipient=booking.client_email,
            due_at=datetime.now(),
            status="draft",
            detail="",
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def reminder_draft(self, reminder_id: uuid.UUID) -> dict[str, Any]:
        rem = await self.get_reminder(reminder_id)
        booking = await self.session.get(AppointmentBooking, rem.booking_id)
        if booking is None:
            raise AppointmentsNotFoundError("Booking not found")
        svc = await self.session.get(AppointmentService, booking.service_id)
        subject, body = reminder_text(await self.get_settings(), booking, svc.name if svc else "")
        return {
            "id": rem.id,
            "booking_id": booking.id,
            "recipient": rem.recipient,
            "status": rem.status,
            "subject": subject,
            "body": body,
            "client_name": booking.client_name,
            "start_at": booking.start_at,
        }

    async def mark_reminder(self, reminder_id: uuid.UUID, status: str) -> AppointmentReminder:
        """Record what staff did with a draft: sent by hand, or skipped."""
        if status not in ("sent", "skipped"):
            raise AppointmentsValidationError("Status must be sent or skipped")
        rem = await self.get_reminder(reminder_id)
        if rem.status not in ("queued", "draft"):
            raise AppointmentsValidationError("This reminder is already closed")
        rem.status, rem.detail = status, ("sent manually" if status == "sent" else "skipped by staff")
        await self.session.flush()
        return rem


def reminder_text(settings: AppointmentSettings, booking: AppointmentBooking, service_name: str) -> tuple[str, str]:
    """Plain-text subject and body, ready to paste into any mail client."""
    who = settings.public_title or ""
    when = booking.start_at.strftime("%Y-%m-%d %H:%M")
    subject = f"Reminder: {service_name} on {when}"
    body = (
        f"Hello {booking.client_name},\n\n"
        f'this is a reminder of your appointment "{service_name}" on {when}'
        f"{f' with {who}' if who else ''}.\n\n"
        "If you cannot attend, please use the cancellation link from your booking confirmation "
        "or reply to this message.\n"
    )
    return subject, body


async def resolve_public(session: AsyncSession, slug: str) -> AppointmentSettings:
    row = await session.scalar(select(AppointmentSettings).where(AppointmentSettings.slug == slug))
    if row is None or not row.online_enabled:
        raise AppointmentsNotFoundError("Booking page not found")
    return row


async def booking_by_token(session: AsyncSession, token: str) -> AppointmentBooking:
    if not token or len(token) < 20:
        raise AppointmentsNotFoundError("Booking not found")
    row = await session.scalar(select(AppointmentBooking).where(AppointmentBooking.cancel_token == token))
    if row is None:
        raise AppointmentsNotFoundError("Booking not found")
    return row


def utcnow() -> datetime:
    return datetime.now(UTC)
