"""Inventory request/response schemas."""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class WarehouseIn(BaseModel):
    code: str = Field(..., min_length=1, max_length=32)
    name: str = Field(..., min_length=1, max_length=128)
    address: str = ""
    is_default: bool = False


class WarehouseUpdate(BaseModel):
    code: str | None = Field(None, min_length=1, max_length=32)
    name: str | None = Field(None, min_length=1, max_length=128)
    address: str | None = None
    is_default: bool | None = None
    active: bool | None = None


class WarehouseResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    code: str
    name: str
    address: str
    is_default: bool
    active: bool


class MovementRow(BaseModel):
    id: uuid.UUID
    item_id: uuid.UUID
    sku: str
    item_name: str
    uom: str
    warehouse_id: uuid.UUID
    warehouse_code: str
    kind: str
    move_date: date
    qty: Decimal
    unit_cost: Decimal
    value: Decimal
    source_type: str
    source_id: str
    source_number: str
    reversal_of_id: uuid.UUID | None
    reversed: bool
    gl_entry_id: uuid.UUID | None
    notes: str
    created_at: datetime


class MovementPage(BaseModel):
    items: list[MovementRow]
    total: int


class MovementResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    item_id: uuid.UUID
    warehouse_id: uuid.UUID
    kind: str
    move_date: date
    qty: Decimal
    unit_cost: Decimal
    value: Decimal
    gl_entry_id: uuid.UUID | None


class TransferIn(BaseModel):
    item_id: uuid.UUID
    from_warehouse_id: uuid.UUID
    to_warehouse_id: uuid.UUID
    qty: Decimal = Field(..., gt=0)
    move_date: date | None = None
    notes: str = ""


class AdjustmentIn(BaseModel):
    item_id: uuid.UUID
    warehouse_id: uuid.UUID | None = None
    kind: Literal["adjustment", "opening"] = "adjustment"
    qty: Decimal
    unit_cost: Decimal | None = Field(None, ge=0)
    move_date: date | None = None
    notes: str = ""


class StockLevel(BaseModel):
    item_id: uuid.UUID
    sku: str
    name: str
    uom: str
    active: bool
    on_hand: Decimal
    by_warehouse: dict[str, Decimal]
    reserved: Decimal
    available: Decimal
    avg_cost: Decimal
    value: Decimal
    min_stock: Decimal
    reorder_qty: Decimal
    below_min: bool


class ItemWarehouseQty(BaseModel):
    warehouse_id: uuid.UUID
    code: str
    name: str
    qty: Decimal


class ItemStock(BaseModel):
    item_id: uuid.UUID
    stock_tracked: bool
    on_hand: Decimal
    reserved: Decimal
    available: Decimal
    avg_cost: Decimal
    value: Decimal
    warehouses: list[ItemWarehouseQty]
    movements: list[MovementRow]
    movement_count: int


class StocktakeCreate(BaseModel):
    warehouse_id: uuid.UUID | None = None
    count_date: date | None = None
    item_ids: list[uuid.UUID] | None = None
    notes: str = ""


class CountIn(BaseModel):
    line_id: uuid.UUID
    counted_qty: Decimal | None = Field(None, ge=0)


class CountsIn(BaseModel):
    counts: list[CountIn]
    notes: str | None = None


class StocktakeLineResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    line_no: int
    item_id: uuid.UUID
    sku: str
    name: str
    uom: str
    expected_qty: Decimal
    counted_qty: Decimal | None
    unit_cost: Decimal
    diff_qty: Decimal
    diff_value: Decimal


class StocktakeResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    number: str
    warehouse_id: uuid.UUID
    status: str
    count_date: date
    notes: str
    diff_value: Decimal
    gl_entry_id: uuid.UUID | None
    created_at: datetime
    lines: list[StocktakeLineResponse] = []


class SettingsIO(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    allow_negative: bool | None = None
    inventory_account: str | None = Field(None, max_length=32)
    cogs_account: str | None = Field(None, max_length=32)
    diff_account: str | None = Field(None, max_length=32)


class SettingsResponse(BaseModel):
    allow_negative: bool
    inventory_account: str
    cogs_account: str
    diff_account: str
    effective: dict[str, str | None]


class InventorySummary(BaseModel):
    items: int
    total_value: Decimal
    below_min: int
    out_of_stock: int
    reserved_items: int
    warehouses: int


class WarehouseListResponse(BaseModel):
    items: list[WarehouseResponse]
    total: int
    offset: int = 0
    limit: int = 50


class StockLevelListResponse(BaseModel):
    items: list[StockLevel]
    total: int
    offset: int = 0
    limit: int = 50


class StocktakeListResponse(BaseModel):
    items: list[StocktakeResponse]
    total: int
    offset: int = 0
    limit: int = 50
