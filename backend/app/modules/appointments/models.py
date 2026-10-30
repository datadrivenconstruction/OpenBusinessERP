"""Appointments ORM models.

Tables:
    oe_appointments_settings   - one row per tenant: online booking, reminders, retention.
    oe_appointments_service    - bookable service (duration, buffers, price, optional catalogue item).
    oe_appointments_resource   - staff member, room, chair or equipment.
    oe_appointments_hours      - weekly working hours / breaks per resource.
    oe_appointments_exception  - dated closures or extra opening per resource.
    oe_appointments_booking    - a booked slot.
    oe_appointments_reminder   - reminder drafts (queued -> draft -> sent by hand / skipped).

Booking times are naive wall-clock times of the business (``settings.timezone`` is
informational), so working hours and bookings compare without conversion.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import GUID, Base

RESOURCE_KINDS: tuple[str, ...] = ("staff", "room", "chair", "equipment")
STATUSES: tuple[str, ...] = ("requested", "confirmed", "checked_in", "completed", "no_show", "cancelled")
SOURCES: tuple[str, ...] = ("staff", "online")


class AppointmentSettings(Base):
    __tablename__ = "oe_appointments_settings"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, unique=True)
    public_title: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    online_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Public URL segment; carries a random suffix so it cannot be guessed from the name.
    slug: Mapped[str] = mapped_column(String(80), nullable=False, unique=True)
    auto_confirm: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    privacy_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    slot_step_min: Mapped[int] = mapped_column(Integer, nullable=False, default=15)
    min_notice_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=2)
    max_days_ahead: Mapped[int] = mapped_column(Integer, nullable=False, default=60)
    retention_days: Mapped[int] = mapped_column(Integer, nullable=False, default=0)  # 0 = keep
    reminders_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    reminder_hours: Mapped[int] = mapped_column(Integer, nullable=False, default=24)
    timezone: Mapped[str] = mapped_column(String(64), nullable=False, default="Europe/Berlin")


class AppointmentService(Base):
    __tablename__ = "oe_appointments_service"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    duration_min: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    buffer_before_min: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    buffer_after_min: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    price: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal(0))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    item_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_items_item.id", ondelete="SET NULL"), nullable=True
    )
    resource_kind: Mapped[str] = mapped_column(String(16), nullable=False, default="staff")
    # Empty -> any active resource of ``resource_kind``.
    resource_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list)  # type: ignore[assignment]
    color: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    online: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class AppointmentResource(Base):
    __tablename__ = "oe_appointments_resource"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="staff")
    color: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class AppointmentHours(Base):
    __tablename__ = "oe_appointments_hours"

    resource_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_appointments_resource.id", ondelete="CASCADE"), nullable=False, index=True
    )
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)  # 0 = Monday
    start_min: Mapped[int] = mapped_column(Integer, nullable=False)  # minutes after midnight
    end_min: Mapped[int] = mapped_column(Integer, nullable=False)
    kind: Mapped[str] = mapped_column(String(8), nullable=False, default="work")  # work | break


class AppointmentException(Base):
    __tablename__ = "oe_appointments_exception"

    resource_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_appointments_resource.id", ondelete="CASCADE"), nullable=False, index=True
    )
    day: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    # closed: null times = whole day off; open: extra working window.
    kind: Mapped[str] = mapped_column(String(8), nullable=False, default="closed")
    start_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    end_min: Mapped[int | None] = mapped_column(Integer, nullable=True)
    label: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class AppointmentBooking(Base):
    __tablename__ = "oe_appointments_booking"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    service_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_appointments_service.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    resource_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_appointments_resource.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    contact_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    client_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    client_email: Mapped[str] = mapped_column(String(255), nullable=False, default="", index=True)
    client_phone: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    start_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    end_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    # Occupied window including the service buffers; conflicts are checked on these.
    block_start: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    block_end: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="confirmed", index=True)
    source: Mapped[str] = mapped_column(String(8), nullable=False, default="staff")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    cancel_token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    consent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    series_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class AppointmentReminder(Base):
    __tablename__ = "oe_appointments_reminder"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    booking_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_appointments_booking.id", ondelete="CASCADE"), nullable=False, index=True
    )
    channel: Mapped[str] = mapped_column(String(8), nullable=False, default="email")
    recipient: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    due_at: Mapped[datetime] = mapped_column(DateTime(timezone=False), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(8), nullable=False, default="queued")  # queued|draft|sent|skipped (never auto-sent)
    detail: Mapped[str] = mapped_column(String(255), nullable=False, default="")
