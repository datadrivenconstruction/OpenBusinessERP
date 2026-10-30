"""Items ORM models.

Tables:
    oe_items_category        - item category (optional parent).
    oe_items_item            - item master row (goods / service / consumable).
    oe_items_price_list      - price list per customer / customer group / currency, dated.
    oe_items_price_list_item - per-item price with quantity break (min_qty).
    oe_items_discount_rule   - percentage discount by item / category / customer, dated.

Every header table carries ``tenant_id`` (= owning user id on single-tenant installs).
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import GUID, Base

PRICE = Numeric(18, 4)
ITEM_TYPES: tuple[str, ...] = ("goods", "service", "consumable")


class ItemsCategory(Base):
    __tablename__ = "oe_items_category"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_oe_items_category_tenant_name"),)

    tenant_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_items_category.id", ondelete="SET NULL"), nullable=True
    )
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")


class Item(Base):
    __tablename__ = "oe_items_item"
    __table_args__ = (UniqueConstraint("tenant_id", "sku", name="uq_oe_items_item_tenant_sku"),)

    tenant_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False, default="")
    item_type: Mapped[str] = mapped_column(String(16), nullable=False, default="goods", index=True)
    uom: Mapped[str] = mapped_column(String(16), nullable=False, default="pcs")
    sales_price: Mapped[Decimal] = mapped_column(PRICE, nullable=False, default=Decimal(0))
    purchase_cost: Mapped[Decimal] = mapped_column(PRICE, nullable=False, default=Decimal(0))
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    tax_code: Mapped[str] = mapped_column(String(16), nullable=False, default="")
    revenue_account: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    expense_account: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    stock_tracked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    barcode: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_items_category.id", ondelete="SET NULL"), nullable=True, index=True
    )
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True, index=True)
    min_stock: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal(0))
    reorder_qty: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal(0))
    # Supplier lives in contacts; plain GUID, no cross-module FK.
    default_supplier_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    image_url: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class ItemPriceList(Base):
    __tablename__ = "oe_items_price_list"

    tenant_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    # Empty group and null customer -> applies to everyone.
    customer_group: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    customer_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    items: Mapped[list[ItemPriceBreak]] = relationship(
        back_populates="price_list", cascade="all, delete-orphan", lazy="selectin",
        order_by="ItemPriceBreak.min_qty",
    )


class ItemPriceBreak(Base):
    __tablename__ = "oe_items_price_list_item"
    __table_args__ = (
        UniqueConstraint("price_list_id", "item_id", "min_qty", name="uq_oe_items_price_list_item_break"),
    )

    price_list_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_items_price_list.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_items_item.id", ondelete="CASCADE"), nullable=False, index=True
    )
    min_qty: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal(0))
    unit_price: Mapped[Decimal] = mapped_column(PRICE, nullable=False)

    price_list: Mapped[ItemPriceList] = relationship(back_populates="items", lazy="raise_on_sql")


class ItemDiscountRule(Base):
    __tablename__ = "oe_items_discount_rule"

    tenant_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    # Null item and category -> applies to all items.
    item_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_items_item.id", ondelete="CASCADE"), nullable=True, index=True
    )
    category_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_items_category.id", ondelete="CASCADE"), nullable=True
    )
    customer_group: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    customer_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    min_qty: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal(0))
    discount_pct: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False)
    valid_from: Mapped[date | None] = mapped_column(Date, nullable=True)
    valid_to: Mapped[date | None] = mapped_column(Date, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
