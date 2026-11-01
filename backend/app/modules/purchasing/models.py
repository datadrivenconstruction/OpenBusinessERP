"""Purchasing ORM models.

Tables:
    oe_purchasing_order          - purchase order header.
    oe_purchasing_order_line     - PO line; tracks received / billed quantities.
    oe_purchasing_receipt        - goods receipt (posted on creation).
    oe_purchasing_receipt_line   - received quantity per PO line, valued at PO price.
    oe_purchasing_bill           - supplier bill or credit note (``kind``) with 3-way match status.
    oe_purchasing_bill_line      - bill line, optionally linked to a PO line.
    oe_purchasing_payment        - payment against a bill.
    oe_purchasing_stock          - on-hand quantity/value per stock-tracked item.
    oe_purchasing_sequence       - gap-free number counter per document kind.
    oe_purchasing_account_map    - GL account code per posting role (overrides defaults).
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import Boolean, Date, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import GUID, Base
from app.modules.gl.models import DEFAULT_TENANT

MONEY = Numeric(18, 2)
QTY = Numeric(18, 4)
PRICE = Numeric(18, 4)
RATE = Numeric(7, 4)


def _tenant() -> Mapped[str]:
    return mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)


class PurchasingOrder(Base):
    __tablename__ = "oe_purchasing_order"
    __table_args__ = (UniqueConstraint("tenant_id", "number", name="uq_oe_purchasing_order_tenant_number"),)

    tenant_id: Mapped[str] = _tenant()
    number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft", index=True)
    # Supplier lives in contacts; plain GUID, no cross-module FK (mirrors sales customers).
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(20, 10), nullable=False, default=Decimal(1))
    doc_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)  # expected delivery
    net_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    tax_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    gross_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    lines: Mapped[list[PurchasingOrderLine]] = relationship(
        back_populates="order", order_by="PurchasingOrderLine.line_no", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def received_pct(self) -> float:
        total = sum((ln.qty for ln in self.lines), Decimal(0))
        if total <= 0:
            return 0.0
        got = sum((min(ln.qty_received, ln.qty) for ln in self.lines), Decimal(0))
        return float(got / total)


class PurchasingOrderLine(Base):
    __tablename__ = "oe_purchasing_order_line"

    tenant_id: Mapped[str] = _tenant()
    order_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_purchasing_order.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    item_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    qty: Mapped[Decimal] = mapped_column(QTY, nullable=False, default=Decimal(1))
    unit_price: Mapped[Decimal] = mapped_column(PRICE, nullable=False, default=Decimal(0))
    discount_pct: Mapped[Decimal] = mapped_column(RATE, nullable=False, default=Decimal(0))
    tax_rate: Mapped[Decimal] = mapped_column(RATE, nullable=False, default=Decimal(0))
    net: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    tax: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    gross: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    qty_received: Mapped[Decimal] = mapped_column(QTY, nullable=False, default=Decimal(0))
    qty_billed: Mapped[Decimal] = mapped_column(QTY, nullable=False, default=Decimal(0))

    order: Mapped[PurchasingOrder] = relationship(back_populates="lines", lazy="raise_on_sql")

    @property
    def remaining_qty(self) -> Decimal:
        return max(Decimal(0), self.qty - self.qty_received)

    @property
    def net_unit_price(self) -> Decimal:
        return self.unit_price * (Decimal(100) - self.discount_pct) / Decimal(100)


class PurchasingReceipt(Base):
    __tablename__ = "oe_purchasing_receipt"
    __table_args__ = (UniqueConstraint("tenant_id", "number", name="uq_oe_purchasing_receipt_tenant_number"),)

    tenant_id: Mapped[str] = _tenant()
    number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="posted", index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_purchasing_order.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_number: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(20, 10), nullable=False, default=Decimal(1))
    doc_date: Mapped[date] = mapped_column(Date, nullable=False)
    value_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    gl_entry_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    lines: Mapped[list[PurchasingReceiptLine]] = relationship(
        back_populates="receipt",
        order_by="PurchasingReceiptLine.line_no",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class PurchasingReceiptLine(Base):
    __tablename__ = "oe_purchasing_receipt_line"

    tenant_id: Mapped[str] = _tenant()
    receipt_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_purchasing_receipt.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_line_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_purchasing_order_line.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    item_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    qty: Mapped[Decimal] = mapped_column(QTY, nullable=False)
    unit_cost: Mapped[Decimal] = mapped_column(PRICE, nullable=False, default=Decimal(0))
    value: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    stock_tracked: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    receipt: Mapped[PurchasingReceipt] = relationship(back_populates="lines", lazy="raise_on_sql")


class PurchasingBill(Base):
    __tablename__ = "oe_purchasing_bill"
    __table_args__ = (UniqueConstraint("tenant_id", "kind", "number", name="uq_oe_purchasing_bill_tenant_kind_number"),)

    tenant_id: Mapped[str] = _tenant()
    kind: Mapped[str] = mapped_column(String(16), nullable=False, default="bill", index=True)
    number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft", index=True)
    supplier_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    supplier_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    supplier_ref: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    order_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_purchasing_order.id", ondelete="SET NULL"), nullable=True, index=True
    )
    receipt_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_purchasing_receipt.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Credit note -> the bill it is applied against.
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_purchasing_bill.id", ondelete="SET NULL"), nullable=True, index=True
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(20, 10), nullable=False, default=Decimal(1))
    doc_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    net_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    tax_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    gross_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    amount_paid: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    match_status: Mapped[str] = mapped_column(String(24), nullable=False, default="none", index=True)
    gl_entry_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    lines: Mapped[list[PurchasingBillLine]] = relationship(
        back_populates="bill", order_by="PurchasingBillLine.line_no", cascade="all, delete-orphan", lazy="selectin"
    )
    payments: Mapped[list[PurchasingPayment]] = relationship(
        back_populates="bill", order_by="PurchasingPayment.pay_date", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def balance_due(self) -> Decimal:
        return (self.gross_total or Decimal(0)) - (self.amount_paid or Decimal(0))

    @property
    def is_overdue(self) -> bool:
        return (
            self.kind == "bill"
            and self.due_date is not None
            and self.due_date < date.today()
            and self.balance_due > 0
            and self.status not in ("paid", "cancelled", "draft", "applied")
        )


class PurchasingBillLine(Base):
    __tablename__ = "oe_purchasing_bill_line"

    tenant_id: Mapped[str] = _tenant()
    bill_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_purchasing_bill.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_line_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_purchasing_order_line.id", ondelete="SET NULL"), nullable=True, index=True
    )
    line_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    item_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    qty: Mapped[Decimal] = mapped_column(QTY, nullable=False, default=Decimal(1))
    unit_price: Mapped[Decimal] = mapped_column(PRICE, nullable=False, default=Decimal(0))
    discount_pct: Mapped[Decimal] = mapped_column(RATE, nullable=False, default=Decimal(0))
    tax_rate: Mapped[Decimal] = mapped_column(RATE, nullable=False, default=Decimal(0))
    net: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    tax: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    gross: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    match_status: Mapped[str] = mapped_column(String(24), nullable=False, default="none")

    bill: Mapped[PurchasingBill] = relationship(back_populates="lines", lazy="raise_on_sql")


class PurchasingPayment(Base):
    __tablename__ = "oe_purchasing_payment"

    tenant_id: Mapped[str] = _tenant()
    bill_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_purchasing_bill.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pay_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    method: Mapped[str] = mapped_column(String(32), nullable=False, default="bank_transfer")
    reference: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    # Base units per one document-currency unit on the payment date (None for base-currency documents).
    fx_rate: Mapped[Decimal | None] = mapped_column(Numeric(20, 10), nullable=True)
    gl_entry_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)

    bill: Mapped[PurchasingBill] = relationship(back_populates="payments", lazy="raise_on_sql")


class PurchasingStock(Base):
    __tablename__ = "oe_purchasing_stock"
    __table_args__ = (UniqueConstraint("tenant_id", "item_id", name="uq_oe_purchasing_stock_tenant_item"),)

    tenant_id: Mapped[str] = _tenant()
    item_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    qty: Mapped[Decimal] = mapped_column(QTY, nullable=False, default=Decimal(0))
    value: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))


class PurchasingSequence(Base):
    __tablename__ = "oe_purchasing_sequence"
    __table_args__ = (UniqueConstraint("tenant_id", "kind", name="uq_oe_purchasing_sequence_tenant_kind"),)

    tenant_id: Mapped[str] = _tenant()
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class PurchasingAccountMap(Base):
    __tablename__ = "oe_purchasing_account_map"
    __table_args__ = (UniqueConstraint("tenant_id", "role", name="uq_oe_purchasing_account_map_tenant_role"),)

    tenant_id: Mapped[str] = _tenant()
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    account_code: Mapped[str] = mapped_column(String(32), nullable=False)
