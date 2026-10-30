"""Banking request/response schemas."""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class AccountIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    iban: str = Field("", max_length=42)
    bic: str = Field("", max_length=11)
    currency: str = Field("EUR", min_length=3, max_length=3)
    gl_account_code: str | None = Field(None, max_length=32)
    opening_balance: Decimal = Decimal(0)
    opening_balance_date: date | None = None


class AccountUpdate(BaseModel):
    name: str | None = Field(None, max_length=120)
    bic: str | None = Field(None, max_length=11)
    currency: str | None = Field(None, min_length=3, max_length=3)
    gl_account_code: str | None = Field(None, max_length=32)
    active: bool | None = None
    opening_balance: Decimal | None = None
    opening_balance_date: date | None = None


class AccountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    name: str
    iban: str
    bic: str
    currency: str
    gl_account_code: str
    active: bool
    opening_balance: Decimal
    opening_balance_date: date | None


class SettingsIO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    amount_tolerance: Decimal | None = Field(None, ge=0)
    date_window_days: int | None = Field(None, ge=0, le=365)
    writeoff_account_code: str | None = Field(None, max_length=32)
    writeoff_max: Decimal | None = Field(None, ge=0)


class StatementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    account_id: uuid.UUID
    filename: str
    format: str
    imported_count: int
    duplicate_count: int


class MatchOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    target_type: str
    target_id: uuid.UUID | None
    target_number: str
    amount: Decimal
    gl_entry_id: uuid.UUID | None


class TransactionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    account_id: uuid.UUID
    booking_date: date
    value_date: date | None
    amount: Decimal
    currency: str
    counterparty_name: str
    counterparty_iban: str
    remittance: str
    reference: str
    status: str
    matched_amount: Decimal
    matches: list[MatchOut] = []


class AllocationOut(BaseModel):
    kind: str
    id: uuid.UUID
    number: str
    amount: Decimal


class SuggestionOut(BaseModel):
    score: float
    allocations: list[AllocationOut]
    reasons: list[str]
    difference: Decimal
    is_split: bool


class AllocationIn(BaseModel):
    target_type: str = Field(..., pattern="^(sales_invoice|purchase_bill)$")
    target_id: uuid.UUID
    amount: Decimal = Field(..., gt=0)


class ConfirmIn(BaseModel):
    allocations: list[AllocationIn] = Field(..., min_length=1)
    write_off_difference: bool = False
    confidence: float | None = Field(None, ge=0, le=1)


class ManualEntryIn(BaseModel):
    account_code: str = Field(..., min_length=1, max_length=32)
    memo: str = Field("", max_length=500)
    amount: Decimal | None = Field(None, gt=0)


class IgnoreIn(BaseModel):
    ignored: bool = True


class OpenItemOut(BaseModel):
    kind: str
    id: uuid.UUID
    number: str
    partner_name: str
    open_amount: Decimal
    currency: str
    due_date: date | None



class AccountSummaryOut(BaseModel):
    account_id: uuid.UUID
    name: str
    iban: str
    currency: str
    active: bool
    balance: Decimal
    opening_balance: Decimal
    opening_balance_date: date | None
    gl_account_code: str
    gl_balance: Decimal | None
    gl_difference: Decimal | None
    line_count: int
    unmatched_count: int
    last_booking_date: date | None


class SummaryOut(BaseModel):
    accounts: list[AccountSummaryOut]
    unmatched_count: int
    unmatched_amount: Decimal
    matched_this_month: int
    matched_amount_this_month: Decimal
    document_matches_this_month: int
    active_rules: int


class PreviewRowOut(BaseModel):
    booking_date: date
    amount: Decimal
    currency: str
    counterparty_name: str
    remittance: str
    reference: str
    state: str  # new | duplicate | duplicate_in_file
    rule_name: str | None


class PreviewOut(BaseModel):
    format: str
    total: int
    new_count: int
    duplicate_count: int
    duplicate_in_file_count: int
    date_from: date | None
    date_to: date | None
    total_in: Decimal
    total_out: Decimal
    currency_mismatch: bool
    currencies: list[str]
    rows: list[PreviewRowOut]


class BulkAcceptIn(BaseModel):
    min_score: float = Field(0.85, ge=0.5, le=1)
    account_id: uuid.UUID | None = None


class BulkAcceptOut(BaseModel):
    accepted: list[uuid.UUID]
    skipped: int
    errors: list[str]


_FIELD = "^(counterparty|text|iban|any)$"
_DIR = "^(in|out|any)$"


class RuleIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    match_field: str = Field("any", pattern=_FIELD)
    pattern: str = Field(..., min_length=1, max_length=200)
    direction: str = Field("any", pattern=_DIR)
    min_amount: Decimal | None = Field(None, ge=0)
    max_amount: Decimal | None = Field(None, ge=0)
    account_code: str = Field(..., min_length=1, max_length=32)
    memo: str = Field("", max_length=200)
    priority: int = Field(100, ge=0, le=10000)
    active: bool = True


class RuleUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=120)
    match_field: str | None = Field(None, pattern=_FIELD)
    pattern: str | None = Field(None, min_length=1, max_length=200)
    direction: str | None = Field(None, pattern=_DIR)
    min_amount: Decimal | None = Field(None, ge=0)
    max_amount: Decimal | None = Field(None, ge=0)
    account_code: str | None = Field(None, min_length=1, max_length=32)
    memo: str | None = Field(None, max_length=200)
    priority: int | None = Field(None, ge=0, le=10000)
    active: bool | None = None


class RuleOut(RuleIn):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    hit_count: int


class ApplyRulesIn(BaseModel):
    account_id: uuid.UUID | None = None
    dry_run: bool = False


class RuleHitOut(BaseModel):
    transaction_id: uuid.UUID
    rule_id: uuid.UUID
    rule_name: str
    account_code: str
    amount: Decimal


class ApplyRulesOut(BaseModel):
    applied: int
    hits: list[RuleHitOut]
    errors: list[str]
