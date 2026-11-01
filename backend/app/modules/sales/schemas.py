"""Sales request/response schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LineIn(BaseModel):
    item_id: uuid.UUID | None = None
    sku: str = Field("", max_length=64)
    description: str = Field("", max_length=500)
    qty: Decimal = Field(Decimal(1), ge=0)
    unit_price: Decimal = Field(Decimal(0), ge=0)
    discount_pct: Decimal = Field(Decimal(0), ge=0, le=100)
    tax_rate: Decimal | None = Field(None, ge=0, le=100)  # None -> company-country default


class DocumentCreate(BaseModel):
    customer_id: uuid.UUID | None = None
    customer_name: str = Field("", max_length=255)
    currency: str = Field("EUR", min_length=3, max_length=3)
    fx_rate: Decimal | None = Field(None, gt=0)
    doc_date: date | None = None
    due_date: date | None = None
    notes: str = ""
    customer_address: str = Field("", max_length=400)
    customer_vat_id: str = Field("", max_length=50)
    customer_email: str = Field("", max_length=255)
    language: str = Field("", max_length=5)
    delivery_date: date | None = None
    delivery_end: date | None = None
    tax_note: str = Field("", max_length=300)
    payment_terms: str = Field("", max_length=64)
    lines: list[LineIn] = Field(default_factory=list)


class DocumentUpdate(BaseModel):
    customer_id: uuid.UUID | None = None
    customer_name: str | None = Field(None, max_length=255)
    currency: str | None = Field(None, min_length=3, max_length=3)
    fx_rate: Decimal | None = Field(None, gt=0)
    doc_date: date | None = None
    due_date: date | None = None
    notes: str | None = None
    customer_address: str | None = Field(None, max_length=400)
    customer_vat_id: str | None = Field(None, max_length=50)
    customer_email: str | None = Field(None, max_length=255)
    language: str | None = Field(None, max_length=5)
    delivery_date: date | None = None
    delivery_end: date | None = None
    tax_note: str | None = Field(None, max_length=300)
    payment_terms: str | None = Field(None, max_length=64)
    lines: list[LineIn] | None = None


class StatusRequest(BaseModel):
    status: str


class PaymentCreate(BaseModel):
    amount: Decimal = Field(..., gt=0)
    pay_date: date | None = None
    method: str = Field("bank_transfer", max_length=32)
    reference: str = Field("", max_length=128)
    # Foreign documents: payment-date rate override, or the actual base-currency amount received/paid.
    fx_rate: Decimal | None = Field(None, gt=0)
    base_amount: Decimal | None = Field(None, gt=0)


class LineResponse(LineIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    line_no: int
    net: Decimal
    tax: Decimal
    gross: Decimal
    remaining_qty: Decimal


class PaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pay_date: date
    amount: Decimal
    method: str
    reference: str
    gl_entry_id: uuid.UUID | None
    fx_rate: Decimal | None = None


class DocumentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    kind: str
    number: str
    status: str
    customer_id: uuid.UUID | None
    customer_name: str
    currency: str
    doc_date: date
    due_date: date | None
    net_total: Decimal
    tax_total: Decimal
    gross_total: Decimal
    amount_paid: Decimal
    balance_due: Decimal
    is_overdue: bool
    source_id: uuid.UUID | None
    gl_entry_id: uuid.UUID | None
    created_at: datetime | None = None


class DocumentResponse(DocumentSummary):
    fx_rate: Decimal
    notes: str
    customer_address: str
    customer_vat_id: str
    customer_email: str
    language: str
    delivery_date: date | None
    delivery_end: date | None
    tax_note: str
    payment_terms: str
    sent_at: datetime | None = None
    sent_to: str = ""
    lines: list[LineResponse]
    payments: list[PaymentResponse]


class AccountMapping(BaseModel):
    receivable: str | None = None
    revenue: str | None = None
    vat: str | None = None
    bank: str | None = None


class SendRequest(BaseModel):
    to: str = Field(..., min_length=3, max_length=255)
    cc: list[str] = Field(default_factory=list, max_length=10)
    subject: str = Field(..., min_length=1, max_length=255)
    body: str = Field("", max_length=8000)


class SendLogResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    sent_by: str | None
    sent_at: datetime
    to_addr: str
    cc: list[str]
    subject: str
    status: str
    detail: str
    backend: str


class InvoiceCheckIssue(BaseModel):
    field: str
    message: str


class EmailDraft(BaseModel):
    to: str
    cc: list[str]
    subject: str
    body: str
    filename: str
    issues: list[InvoiceCheckIssue]
    mail_configured: bool = False


class ConvertLine(BaseModel):
    line_id: uuid.UUID
    qty: Decimal = Field(..., gt=0)


class ConvertRequest(BaseModel):
    lines: list[ConvertLine] | None = None  # None -> everything still open


class BulkRequest(BaseModel):
    action: Literal["mark_sent", "delete_drafts", "reminder_drafts"]
    ids: list[uuid.UUID] = Field(..., max_length=500)


class BulkSkipped(BaseModel):
    id: uuid.UUID
    reason: str


class BulkDraft(BaseModel):
    id: uuid.UUID
    number: str
    to: str
    subject: str
    body: str


class BulkResponse(BaseModel):
    processed: int
    skipped: list[BulkSkipped]
    drafts: list[BulkDraft]


class ActivityEvent(BaseModel):
    at: datetime
    type: str
    actor: str | None
    message: str
    ref_id: uuid.UUID | None


class RelatedResponse(BaseModel):
    source: DocumentSummary | None
    derived: list[DocumentSummary]


class SalesStats(BaseModel):
    currency: str
    open_quotes_count: int
    open_quotes_value: Decimal
    win_rate: float | None
    orders_to_invoice_count: int
    orders_to_invoice_value: Decimal
    invoiced_this_month: Decimal
    overdue_count: int
    overdue_value: Decimal
