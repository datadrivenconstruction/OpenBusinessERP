"""Receivables request/response schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class LevelIO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    level: int = Field(..., ge=1, le=9)
    name: str = Field(..., min_length=1, max_length=80)
    days_after_due: int = Field(..., ge=0, le=3650)
    fee: Decimal = Field(Decimal(0), ge=0)
    subject: str = Field("", max_length=255)
    body: str = ""


class SettingsIO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    fees_enabled: bool | None = None
    interest_enabled: bool | None = None
    interest_rate_pct: Decimal | None = Field(None, ge=0, le=100)
    min_days_between: int | None = Field(None, ge=0, le=365)


class BlockIn(BaseModel):
    partner_key: str = Field(..., min_length=1, max_length=300)
    customer_name: str = Field("", max_length=255)
    reason: str = Field("", max_length=500)


class BlockOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    partner_key: str
    customer_name: str
    reason: str


class LetterOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_id: uuid.UUID
    invoice_id: uuid.UUID
    invoice_number: str
    partner_key: str
    customer_name: str
    level: int
    letter_date: date
    days_overdue: int
    currency: str
    outstanding: Decimal
    fee: Decimal
    interest: Decimal
    channel: str
    subject: str
    body: str
    status: str
    decided_at: datetime | None


class LetterUpdate(BaseModel):
    subject: str | None = Field(None, max_length=255)
    body: str | None = None
    channel: str | None = Field(None, pattern="^(letter|email)$")


class DecisionIn(BaseModel):
    decision: str = Field(..., pattern="^(approved|discarded)$")


class RunIn(BaseModel):
    as_of: date | None = None


class RunOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    run_date: date
    letters: list[LetterOut]


class FollowUpIn(BaseModel):
    partner_key: str = Field(..., min_length=1, max_length=300)
    customer_name: str = Field("", max_length=255)
    kind: str = Field("note", pattern="^(note|promise)$")
    text: str = Field("", max_length=4000)
    invoice_id: uuid.UUID | None = None
    promised_date: date | None = None
    promised_amount: Decimal | None = Field(None, gt=0)


class FollowUpStatusIn(BaseModel):
    status: str = Field(..., pattern="^(open|kept|broken|cancelled)$")
