"""Purchasing request/response schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class LineIn(BaseModel):
    item_id: uuid.UUID | None = None
    order_line_id: uuid.UUID | None = None
    sku: str = Field("", max_length=64)
    description: str = Field("", max_length=500)
    qty: Decimal = Field(Decimal(1), ge=0)
    unit_price: Decimal = Field(Decimal(0), ge=0)
    discount_pct: Decimal = Field(Decimal(0), ge=0, le=100)
    tax_rate: Decimal | None = Field(None, ge=0, le=100)  # None -> company-country default


class _Header(BaseModel):
    supplier_id: uuid.UUID | None = None
    supplier_name: str | None = Field(None, max_length=255)
    currency: str | None = Field(None, min_length=3, max_length=3)
    fx_rate: Decimal | None = Field(None, gt=0)
    doc_date: date | None = None
    due_date: date | None = None
    notes: str | None = None
    lines: list[LineIn] | None = None


class OrderCreate(_Header):
    lines: list[LineIn] | None = Field(default_factory=list)


class OrderUpdate(_Header):
    pass


class BillCreate(_Header):
    supplier_ref: str | None = Field(None, max_length=64)
    order_id: uuid.UUID | None = None
    source_id: uuid.UUID | None = None
    lines: list[LineIn] | None = Field(default_factory=list)


class BillUpdate(_Header):
    supplier_ref: str | None = Field(None, max_length=64)


class StatusRequest(BaseModel):
    status: str


class ReceiveLine(BaseModel):
    order_line_id: uuid.UUID
    qty: Decimal = Field(..., ge=0)


class ReceiveRequest(BaseModel):
    lines: list[ReceiveLine] | None = None  # None -> receive everything still open
    doc_date: date | None = None
    notes: str = ""
    warehouse_id: uuid.UUID | None = None  # None -> default warehouse


class PaymentCreate(BaseModel):
    amount: Decimal = Field(..., gt=0)
    pay_date: date | None = None
    method: str = Field("bank_transfer", max_length=32)
    reference: str = Field("", max_length=128)
    # Foreign documents: payment-date rate override, or the actual base-currency amount received/paid.
    fx_rate: Decimal | None = Field(None, gt=0)
    base_amount: Decimal | None = Field(None, gt=0)


class _Line(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    line_no: int
    item_id: uuid.UUID | None
    sku: str
    description: str
    qty: Decimal
    unit_price: Decimal
    discount_pct: Decimal
    tax_rate: Decimal
    net: Decimal
    tax: Decimal
    gross: Decimal


class OrderLineResponse(_Line):
    qty_received: Decimal
    qty_billed: Decimal
    remaining_qty: Decimal


class BillLineResponse(_Line):
    order_line_id: uuid.UUID | None
    match_status: str


class _DocSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    number: str
    status: str
    supplier_id: uuid.UUID | None
    supplier_name: str
    currency: str
    doc_date: date
    due_date: date | None
    net_total: Decimal
    tax_total: Decimal
    gross_total: Decimal
    created_at: datetime | None = None


class OrderSummary(_DocSummary):
    received_pct: float


class OrderResponse(OrderSummary):
    fx_rate: Decimal
    notes: str
    lines: list[OrderLineResponse]


class ReceiptLineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    order_line_id: uuid.UUID
    line_no: int
    item_id: uuid.UUID | None
    sku: str
    description: str
    qty: Decimal
    unit_cost: Decimal
    value: Decimal
    stock_tracked: bool


class ReceiptResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    number: str
    status: str
    order_id: uuid.UUID
    order_number: str
    supplier_name: str
    currency: str
    doc_date: date
    value_total: Decimal
    gl_entry_id: uuid.UUID | None
    notes: str
    lines: list[ReceiptLineResponse]


class PaymentResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    pay_date: date
    amount: Decimal
    method: str
    reference: str
    gl_entry_id: uuid.UUID | None


class BillSummary(_DocSummary):
    kind: str
    supplier_ref: str
    order_id: uuid.UUID | None
    receipt_id: uuid.UUID | None
    source_id: uuid.UUID | None
    amount_paid: Decimal
    balance_due: Decimal
    is_overdue: bool
    match_status: str
    gl_entry_id: uuid.UUID | None


class BillResponse(BillSummary):
    fx_rate: Decimal
    notes: str
    lines: list[BillLineResponse]
    payments: list[PaymentResponse]


class StockResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    item_id: uuid.UUID
    sku: str
    qty: Decimal
    value: Decimal


class AccountMapping(BaseModel):
    inventory: str | None = None
    grni: str | None = None
    expense: str | None = None
    input_vat: str | None = None
    payables: str | None = None
    bank: str | None = None


class ReceiptSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    number: str
    status: str
    order_id: uuid.UUID
    order_number: str
    supplier_name: str
    currency: str
    doc_date: date
    value_total: Decimal
    gl_entry_id: uuid.UUID | None


class BulkRequest(BaseModel):
    action: Literal["mark_sent", "delete_drafts", "reminder_drafts"]
    ids: list[uuid.UUID] = Field(..., max_length=500)


class BulkSkipped(BaseModel):
    id: uuid.UUID
    reason: str


class BulkResponse(BaseModel):
    processed: int
    skipped: list[BulkSkipped]
    drafts: list[dict] = Field(default_factory=list)


class ActivityEvent(BaseModel):
    at: datetime
    type: str
    actor: str | None
    message: str
    ref_id: uuid.UUID | None


class OrderDerived(BaseModel):
    receipts: list[ReceiptSummary]
    bills: list[BillSummary]


class OrderRelated(BaseModel):
    source: None = None
    derived: OrderDerived


class BillSource(BaseModel):
    order: OrderSummary | None
    receipt: ReceiptSummary | None
    bill: BillSummary | None = None  # credit note -> the bill it is applied against


class BillRelated(BaseModel):
    source: BillSource | None
    derived: list[BillSummary]


class PurchasingStats(BaseModel):
    currency: str
    open_po_count: int
    open_po_value: Decimal
    to_receive_count: int
    to_receive_value: Decimal
    bills_due_week_count: int
    bills_due_week_value: Decimal
    overdue_count: int
    overdue_value: Decimal
