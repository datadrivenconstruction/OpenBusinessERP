"""Items request/response schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

ItemType = Literal["goods", "service", "consumable"]


class CategoryIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    parent_id: uuid.UUID | None = None
    description: str = ""


class CategoryUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    parent_id: uuid.UUID | None = None
    description: str | None = None


class CategoryResponse(CategoryIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class ItemIn(BaseModel):
    sku: str = Field(..., min_length=1, max_length=64)
    name: str = Field(..., min_length=1, max_length=255)
    description: str = ""
    item_type: ItemType = "goods"
    uom: str = Field("pcs", min_length=1, max_length=16)
    sales_price: Decimal = Field(Decimal(0), ge=0)
    purchase_cost: Decimal = Field(Decimal(0), ge=0)
    currency: str = Field("EUR", min_length=3, max_length=3)
    tax_code: str = Field("", max_length=16)
    revenue_account: str = Field("", max_length=32)
    expense_account: str = Field("", max_length=32)
    stock_tracked: bool = False
    barcode: str = Field("", max_length=64)
    category_id: uuid.UUID | None = None
    active: bool = True
    min_stock: Decimal = Field(Decimal(0), ge=0)
    reorder_qty: Decimal = Field(Decimal(0), ge=0)
    default_supplier_id: uuid.UUID | None = None
    image_url: str = Field("", max_length=500)
    notes: str = ""


class ItemUpdate(BaseModel):
    sku: str | None = Field(None, min_length=1, max_length=64)
    name: str | None = Field(None, min_length=1, max_length=255)
    description: str | None = None
    item_type: ItemType | None = None
    uom: str | None = Field(None, min_length=1, max_length=16)
    sales_price: Decimal | None = Field(None, ge=0)
    purchase_cost: Decimal | None = Field(None, ge=0)
    currency: str | None = Field(None, min_length=3, max_length=3)
    tax_code: str | None = Field(None, max_length=16)
    revenue_account: str | None = Field(None, max_length=32)
    expense_account: str | None = Field(None, max_length=32)
    stock_tracked: bool | None = None
    barcode: str | None = Field(None, max_length=64)
    category_id: uuid.UUID | None = None
    active: bool | None = None
    min_stock: Decimal | None = Field(None, ge=0)
    reorder_qty: Decimal | None = Field(None, ge=0)
    default_supplier_id: uuid.UUID | None = None
    image_url: str | None = Field(None, max_length=500)
    notes: str | None = None


class ItemResponse(ItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    created_at: datetime | None = None
    updated_at: datetime | None = None


class ItemPage(BaseModel):
    items: list[ItemResponse]
    total: int
    # item_id -> on-hand quantity for stock-tracked items on this page.
    on_hand: dict[str, Decimal] = Field(default_factory=dict)


class ItemStats(BaseModel):
    total: int
    active: int
    inactive: int
    goods: int
    services: int
    consumables: int
    stock_tracked: int
    avg_margin_pct: Decimal | None
    without_price: int
    below_min_stock: int
    categories: int


BulkAction = Literal["activate", "deactivate", "set_category", "set_tax_code", "adjust_prices", "delete"]


class BulkIn(BaseModel):
    ids: list[uuid.UUID] = Field(..., min_length=1, max_length=1000)
    action: BulkAction
    category_id: uuid.UUID | None = None
    tax_code: str = Field("", max_length=16)
    pct: Decimal | None = Field(None, gt=-100, le=1000)
    target: Literal["sales", "cost", "both"] = "sales"


class BulkResult(BaseModel):
    affected: int


class CategoryCount(BaseModel):
    category_id: uuid.UUID | None
    count: int


class SalesHistoryRow(BaseModel):
    document_id: uuid.UUID
    kind: str
    number: str
    status: str
    doc_date: date
    customer_name: str
    currency: str
    qty: Decimal
    unit_price: Decimal
    discount_pct: Decimal
    net: Decimal


class PurchaseHistoryRow(BaseModel):
    order_id: uuid.UUID
    number: str
    status: str
    doc_date: date
    supplier_name: str
    currency: str
    qty: Decimal
    qty_received: Decimal
    unit_price: Decimal
    net: Decimal


class ItemPriceBreakRow(BaseModel):
    price_list_id: uuid.UUID
    price_list_name: str
    currency: str
    customer_group: str
    customer_id: uuid.UUID | None
    valid_from: date | None
    valid_to: date | None
    active: bool
    min_qty: Decimal
    unit_price: Decimal


class ImportResult(BaseModel):
    created: int
    updated: int


class PriceListItemIn(BaseModel):
    item_id: uuid.UUID
    min_qty: Decimal = Field(Decimal(0), ge=0)
    unit_price: Decimal = Field(..., ge=0)


class PriceListItemResponse(PriceListItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class PriceListIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    currency: str = Field("EUR", min_length=3, max_length=3)
    customer_group: str = Field("", max_length=64)
    customer_id: uuid.UUID | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    priority: int = 0
    active: bool = True
    items: list[PriceListItemIn] = Field(default_factory=list)


class PriceListUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    currency: str | None = Field(None, min_length=3, max_length=3)
    customer_group: str | None = Field(None, max_length=64)
    customer_id: uuid.UUID | None = None
    valid_from: date | None = None
    valid_to: date | None = None
    priority: int | None = None
    active: bool | None = None
    items: list[PriceListItemIn] | None = None


class PriceListResponse(PriceListIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    items: list[PriceListItemResponse]


class DiscountRuleIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=128)
    item_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    customer_group: str = Field("", max_length=64)
    customer_id: uuid.UUID | None = None
    min_qty: Decimal = Field(Decimal(0), ge=0)
    discount_pct: Decimal = Field(..., gt=0, le=100)
    valid_from: date | None = None
    valid_to: date | None = None
    active: bool = True


class DiscountRuleUpdate(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=128)
    item_id: uuid.UUID | None = None
    category_id: uuid.UUID | None = None
    customer_group: str | None = Field(None, max_length=64)
    customer_id: uuid.UUID | None = None
    min_qty: Decimal | None = Field(None, ge=0)
    discount_pct: Decimal | None = Field(None, gt=0, le=100)
    valid_from: date | None = None
    valid_to: date | None = None
    active: bool | None = None


class DiscountRuleResponse(DiscountRuleIn):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID


class PriceQuote(BaseModel):
    item_id: uuid.UUID
    currency: str
    qty: Decimal
    list_price: Decimal
    discount_pct: Decimal
    unit_price: Decimal
    source: Literal["item", "price_list"]
    price_list_id: uuid.UUID | None = None
    discount_rule_id: uuid.UUID | None = None
