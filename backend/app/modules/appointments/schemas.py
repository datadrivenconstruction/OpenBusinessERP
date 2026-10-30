"""Appointments API schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field

NOTE_HINT = "Scheduling notes only - do not enter clinical details"


class _Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class SettingsUpdate(BaseModel):
    public_title: str | None = Field(None, max_length=255)
    online_enabled: bool | None = None
    auto_confirm: bool | None = None
    privacy_url: str | None = Field(None, max_length=500)
    slot_step_min: int | None = Field(None, ge=5, le=240)
    min_notice_hours: int | None = Field(None, ge=0, le=720)
    max_days_ahead: int | None = Field(None, ge=1, le=365)
    retention_days: int | None = Field(None, ge=0, le=3650)
    reminders_enabled: bool | None = None
    reminder_hours: int | None = Field(None, ge=1, le=336)
    timezone: str | None = Field(None, max_length=64)


class SettingsResponse(_Out):
    public_title: str
    online_enabled: bool
    slug: str
    auto_confirm: bool
    privacy_url: str
    slot_step_min: int
    min_notice_hours: int
    max_days_ahead: int
    retention_days: int
    reminders_enabled: bool
    reminder_hours: int
    timezone: str


class ServiceIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    duration_min: int = Field(30, ge=5, le=1440)
    buffer_before_min: int = Field(0, ge=0, le=240)
    buffer_after_min: int = Field(0, ge=0, le=240)
    price: Decimal = Field(Decimal(0), ge=0)
    currency: str = Field("EUR", min_length=3, max_length=3)
    item_id: uuid.UUID | None = None
    resource_kind: str = "staff"
    resource_ids: list[uuid.UUID] = Field(default_factory=list)
    color: str = Field("", max_length=16)
    online: bool = True
    active: bool = True


class ServiceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    duration_min: int | None = Field(None, ge=5, le=1440)
    buffer_before_min: int | None = Field(None, ge=0, le=240)
    buffer_after_min: int | None = Field(None, ge=0, le=240)
    price: Decimal | None = Field(None, ge=0)
    currency: str | None = Field(None, min_length=3, max_length=3)
    item_id: uuid.UUID | None = None
    resource_kind: str | None = None
    resource_ids: list[uuid.UUID] | None = None
    color: str | None = Field(None, max_length=16)
    online: bool | None = None
    active: bool | None = None


class ServiceResponse(_Out):
    id: uuid.UUID
    name: str
    description: str
    duration_min: int
    buffer_before_min: int
    buffer_after_min: int
    price: Decimal
    currency: str
    item_id: uuid.UUID | None
    resource_kind: str
    resource_ids: list[str]
    color: str
    online: bool
    active: bool


class HoursIn(BaseModel):
    weekday: int = Field(..., ge=0, le=6)
    start_min: int = Field(..., ge=0, le=1440)
    end_min: int = Field(..., ge=0, le=1440)
    kind: str = "work"


class HoursResponse(HoursIn, _Out):
    id: uuid.UUID


class ExceptionIn(BaseModel):
    day: date
    kind: str = "closed"
    start_min: int | None = Field(None, ge=0, le=1440)
    end_min: int | None = Field(None, ge=0, le=1440)
    label: str = Field("", max_length=255)


class ExceptionResponse(ExceptionIn, _Out):
    id: uuid.UUID
    resource_id: uuid.UUID


class ResourceIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    kind: str = "staff"
    color: str = Field("", max_length=16)
    active: bool = True
    sort_order: int = 0
    hours: list[HoursIn] | None = None


class ResourceUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=255)
    kind: str | None = None
    color: str | None = Field(None, max_length=16)
    active: bool | None = None
    sort_order: int | None = None


class ResourceResponse(_Out):
    id: uuid.UUID
    name: str
    kind: str
    color: str
    active: bool
    sort_order: int


class BookingIn(BaseModel):
    service_id: uuid.UUID
    start_at: datetime
    resource_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    create_contact: bool = False
    client_name: str = Field("", max_length=255)
    client_email: str = Field("", max_length=255)
    client_phone: str = Field("", max_length=64)
    notes: str = Field("", max_length=2000, description=NOTE_HINT)
    status: str = "confirmed"
    repeat_weeks: int = Field(0, ge=0, le=52)


class BookingUpdate(BaseModel):
    service_id: uuid.UUID | None = None
    start_at: datetime | None = None
    resource_id: uuid.UUID | None = None
    contact_id: uuid.UUID | None = None
    client_name: str | None = Field(None, max_length=255)
    client_email: str | None = Field(None, max_length=255)
    client_phone: str | None = Field(None, max_length=64)
    notes: str | None = Field(None, max_length=2000, description=NOTE_HINT)


class StatusIn(BaseModel):
    status: str


class BookingResponse(_Out):
    id: uuid.UUID
    service_id: uuid.UUID
    resource_id: uuid.UUID
    contact_id: uuid.UUID | None
    client_name: str
    client_email: str
    client_phone: str
    start_at: datetime
    end_at: datetime
    status: str
    source: str
    notes: str
    consent_at: datetime | None
    series_id: uuid.UUID | None
    invoice_id: uuid.UUID | None


class SlotResponse(BaseModel):
    start_at: datetime
    resource_id: uuid.UUID


class InvoiceCreated(BaseModel):
    invoice_id: uuid.UUID
    number: str
    gross_total: Decimal


class ReminderResponse(_Out):
    id: uuid.UUID
    booking_id: uuid.UUID
    channel: str
    recipient: str
    due_at: datetime
    status: str
    detail: str


class ReminderDraft(BaseModel):
    id: uuid.UUID
    booking_id: uuid.UUID
    recipient: str
    status: str
    subject: str
    body: str
    client_name: str
    start_at: datetime


class ReminderMarkIn(BaseModel):
    status: str


class CountResponse(BaseModel):
    count: int


# ── Public (no auth) ──────────────────────────────────────────────────────
class PublicService(BaseModel):
    id: uuid.UUID
    name: str
    description: str
    duration_min: int
    price: Decimal
    currency: str


class PublicProfile(BaseModel):
    title: str
    privacy_url: str
    max_days_ahead: int
    services: list[PublicService]


class PublicSlot(BaseModel):
    start_at: datetime


class PublicBookingIn(BaseModel):
    service_id: uuid.UUID
    start_at: datetime
    name: str = Field(..., min_length=1, max_length=255)
    email: str = Field(..., min_length=3, max_length=255, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    phone: str = Field("", max_length=64)
    note: str = Field("", max_length=1000, description=NOTE_HINT)
    consent: bool = False
    website: str = Field("", max_length=200)  # honeypot: humans leave it empty


class PublicBookingResponse(BaseModel):
    status: str
    service_name: str
    start_at: datetime
    end_at: datetime
    cancel_token: str


class PublicBookingView(BaseModel):
    status: str
    service_name: str
    title: str
    start_at: datetime
    end_at: datetime
    can_cancel: bool
