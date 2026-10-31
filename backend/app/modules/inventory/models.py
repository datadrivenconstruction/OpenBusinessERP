"""Inventory ORM models.

Tables:
    oe_inventory_warehouse       - storage location; one per tenant is the default.
    oe_inventory_movement        - signed stock movement (qty and base-currency value).
    oe_inventory_item_cost       - running moving-average cost per item (all warehouses).
    oe_inventory_stocktake       - count sheet per warehouse.
    oe_inventory_stocktake_line  - expected vs counted quantity per item.
    oe_inventory_settings        - per-tenant options (negative stock, GL account overrides).
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import GUID, Base

QTY = Numeric(18, 4)
COST = Numeric(18, 6)
MONEY = Numeric(18, 2)
MOVE_KINDS: tuple[str, ...] = ("opening", "receipt", "delivery", "transfer_in", "transfer_out", "adjustment")


def _tenant() -> Mapped[str]:
    return mapped_column(String(36), nullable=False, index=True)


class Warehouse(Base):
    __tablename__ = "oe_inventory_warehouse"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_oe_inventory_warehouse_tenant_code"),)

    tenant_id: Mapped[str] = _tenant()
    code: Mapped[str] = mapped_column(String(32), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    is_default: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)


class StockMovement(Base):
    __tablename__ = "oe_inventory_movement"

    tenant_id: Mapped[str] = _tenant()
    item_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_inventory_warehouse.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    move_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    qty: Mapped[Decimal] = mapped_column(QTY, nullable=False)  # signed: + in, - out
    unit_cost: Mapped[Decimal] = mapped_column(COST, nullable=False, default=Decimal(0))
    value: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))  # signed, base currency
    source_type: Mapped[str] = mapped_column(String(32), nullable=False, default="", index=True)
    source_id: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    source_number: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    reversal_of_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    reversed: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    transfer_group: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    gl_entry_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class ItemCost(Base):
    __tablename__ = "oe_inventory_item_cost"
    __table_args__ = (UniqueConstraint("tenant_id", "item_id", name="uq_oe_inventory_item_cost_tenant_item"),)

    tenant_id: Mapped[str] = _tenant()
    item_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False)
    qty: Mapped[Decimal] = mapped_column(QTY, nullable=False, default=Decimal(0))
    value: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    avg_cost: Mapped[Decimal] = mapped_column(COST, nullable=False, default=Decimal(0))


class Stocktake(Base):
    __tablename__ = "oe_inventory_stocktake"

    tenant_id: Mapped[str] = _tenant()
    number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    warehouse_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_inventory_warehouse.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="draft", index=True)
    count_date: Mapped[date] = mapped_column(Date, nullable=False)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    diff_value: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    gl_entry_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    lines: Mapped[list[StocktakeLine]] = relationship(
        back_populates="stocktake",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="StocktakeLine.line_no",
    )


class StocktakeLine(Base):
    __tablename__ = "oe_inventory_stocktake_line"

    stocktake_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_inventory_stocktake.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    item_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    uom: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    expected_qty: Mapped[Decimal] = mapped_column(QTY, nullable=False, default=Decimal(0))
    counted_qty: Mapped[Decimal | None] = mapped_column(QTY, nullable=True)
    unit_cost: Mapped[Decimal] = mapped_column(COST, nullable=False, default=Decimal(0))
    diff_qty: Mapped[Decimal] = mapped_column(QTY, nullable=False, default=Decimal(0))
    diff_value: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))

    stocktake: Mapped[Stocktake] = relationship(back_populates="lines", lazy="raise_on_sql")


class InventorySettings(Base):
    __tablename__ = "oe_inventory_settings"
    __table_args__ = (UniqueConstraint("tenant_id", name="uq_oe_inventory_settings_tenant"),)

    tenant_id: Mapped[str] = _tenant()
    allow_negative: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    # Empty -> chart default (DEFAULT_ACCOUNTS in service; inventory falls back to the purchasing role).
    inventory_account: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    cogs_account: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    diff_account: Mapped[str] = mapped_column(String(32), nullable=False, default="")
