"""Recurring invoice request/response schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.modules.sales.schemas import LineIn

Interval = Literal["weekly", "monthly", "quarterly", "yearly"]


class RecurringBase(BaseModel):
    name: str = Field("", max_length=255)
    customer_id: uuid.UUID | None = None
    customer_name: str = Field("", max_length=255)
    customer_email: str = Field("", max_length=255)
    customer_address: str = Field("", max_length=400)
    currency: str = Field("EUR", min_length=3, max_length=3)
    notes: str = ""
    interval: Interval = "monthly"
    interval_count: int = Field(1, ge=1, le=36)
    start_date: date
    end_date: date | None = None
    max_count: int | None = Field(None, ge=1, le=1000)
    day_of_month: int | None = Field(None, ge=1, le=31)
    payment_terms_days: int = Field(14, ge=0, le=365)
    auto_issue: bool = True
    auto_send: bool = False


class RecurringCreate(RecurringBase):
    lines: list[LineIn] = Field(default_factory=list)


class RecurringUpdate(BaseModel):
    name: str | None = Field(None, max_length=255)
    customer_id: uuid.UUID | None = None
    customer_name: str | None = Field(None, max_length=255)
    customer_email: str | None = Field(None, max_length=255)
    customer_address: str | None = Field(None, max_length=400)
    currency: str | None = Field(None, min_length=3, max_length=3)
    notes: str | None = None
    interval: Interval | None = None
    interval_count: int | None = Field(None, ge=1, le=36)
    start_date: date | None = None
    end_date: date | None = None
    max_count: int | None = Field(None, ge=1, le=1000)
    day_of_month: int | None = Field(None, ge=1, le=31)
    payment_terms_days: int | None = Field(None, ge=0, le=365)
    auto_issue: bool | None = None
    auto_send: bool | None = None
    lines: list[LineIn] | None = None


class RecurringResponse(RecurringBase):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    status: str
    lines: list[dict[str, Any]]
    net_total: Decimal
    gross_total: Decimal
    next_run_date: date | None
    generated_count: int
    last_document_id: uuid.UUID | None
    last_run_at: datetime | None
    last_error: str
    created_at: datetime


class RecurringRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    period_date: date
    document_id: uuid.UUID | None
    document_number: str
    gross_total: Decimal
    status: str
    detail: str
    trigger: str
    created_at: datetime


class RecurringPage(BaseModel):
    items: list[RecurringResponse]
    total: int
    offset: int
    limit: int


class RecurringRunPage(BaseModel):
    items: list[RecurringRunResponse]
    total: int
    offset: int
    limit: int


class GenerateResponse(BaseModel):
    template_id: uuid.UUID
    period_date: date | None
    document_id: uuid.UUID | None
    status: str
    detail: str = ""


class RecurringSummary(BaseModel):
    active: int
    paused: int
    ended: int
    due_next_7_days: int
    mrr: dict[str, str]
    arr: dict[str, str]
