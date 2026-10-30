# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""General Ledger request/response schemas."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

AccountType = Literal["asset", "liability", "equity", "income", "expense"]


class AccountCreate(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=255)
    account_type: AccountType
    parent_id: uuid.UUID | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    is_postable: bool = True
    active: bool = True


class AccountUpdate(BaseModel):
    name: str | None = Field(default=None, max_length=255)
    account_type: AccountType | None = None
    parent_id: uuid.UUID | None = None
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    is_postable: bool | None = None
    active: bool | None = None


class AccountResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    code: str
    name: str
    account_type: str
    parent_id: uuid.UUID | None
    currency: str | None
    is_postable: bool
    active: bool
    template: str | None


class TemplateLoadResponse(BaseModel):
    template: str
    created: int
    skipped: int


class FiscalYearCreate(BaseModel):
    name: str = Field(min_length=1, max_length=32)
    start_date: date
    end_date: date


class PeriodResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    fiscal_year_id: uuid.UUID
    name: str
    start_date: date
    end_date: date
    status: str


class FiscalYearResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    start_date: date
    end_date: date
    status: str
    last_number: int
    periods: list[PeriodResponse] = []


class PeriodStatusRequest(BaseModel):
    status: Literal["open", "closed"]


class LineIn(BaseModel):
    account_id: uuid.UUID
    debit: Decimal = Field(default=Decimal(0), ge=0)
    credit: Decimal = Field(default=Decimal(0), ge=0)
    description: str = Field(default="", max_length=500)
    tax_code: str | None = Field(default=None, max_length=32)
    cost_center: str | None = Field(default=None, max_length=64)
    project_id: uuid.UUID | None = None


class EntryCreate(BaseModel):
    entry_date: date
    currency: str | None = Field(default=None, min_length=3, max_length=3)
    fx_rate: Decimal | None = Field(default=None, gt=0)
    memo: str = ""
    source_type: str | None = Field(default=None, max_length=64)
    source_id: str | None = Field(default=None, max_length=64)
    lines: list[LineIn] = Field(min_length=2)


class EntryUpdate(BaseModel):
    entry_date: date | None = None
    fx_rate: Decimal | None = Field(default=None, gt=0)
    memo: str | None = None
    source_type: str | None = None
    source_id: str | None = None
    lines: list[LineIn] | None = Field(default=None, min_length=2)


class ReverseRequest(BaseModel):
    on: date | None = None
    memo: str | None = None


class LineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    line_no: int
    account_id: uuid.UUID
    description: str
    debit: Decimal
    credit: Decimal
    base_debit: Decimal
    base_credit: Decimal
    tax_code: str | None
    cost_center: str | None
    project_id: uuid.UUID | None


class EntryResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    number: str | None
    entry_date: date
    period_id: uuid.UUID
    fiscal_year_id: uuid.UUID
    currency: str
    base_currency: str
    fx_rate: Decimal
    status: str
    source_type: str | None
    source_id: str | None
    memo: str
    reversal_of_id: uuid.UUID | None
    reversed_by_id: uuid.UUID | None
    lines: list[LineResponse]
