"""Sales ORM models.

Tables:
    oe_sales_document    - quote / order / invoice header (``kind`` discriminates).
    oe_sales_line        - document line with per-line rounded net/tax/gross.
    oe_sales_payment     - customer payment against an invoice.
    oe_sales_sequence    - gap-free number counter per document kind.
    oe_sales_account_map - GL account code per posting role (overrides defaults).
    oe_sales_send_log    - who emailed which document to whom, and the outcome.
    oe_sales_payment_link - online payment link (Stripe / Mollie) per invoice; settled once by webhook.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import GUID, Base
from app.modules.gl.models import DEFAULT_TENANT

MONEY = Numeric(18, 2)
KINDS: tuple[str, ...] = ("quote", "order", "invoice", "credit_note")


class SalesDocument(Base):
    __tablename__ = "oe_sales_document"
    __table_args__ = (UniqueConstraint("tenant_id", "kind", "number", name="uq_oe_sales_document_tenant_kind_number"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False, index=True)
    number: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="draft", index=True)
    # Customer lives in contacts (or CRM account); plain GUID, no cross-module FK.
    customer_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(20, 10), nullable=False, default=Decimal(1))
    doc_date: Mapped[date] = mapped_column(Date, nullable=False)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_sales_document.id", ondelete="SET NULL"), nullable=True, index=True
    )
    net_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    tax_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    gross_total: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    amount_paid: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    gl_entry_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # Recipient block and invoice data printed on the PDF.
    customer_address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    customer_vat_id: Mapped[str] = mapped_column(String(50), nullable=False, default="")
    customer_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    language: Mapped[str] = mapped_column(String(5), nullable=False, default="")
    delivery_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    delivery_end: Mapped[date | None] = mapped_column(Date, nullable=True)
    tax_note: Mapped[str] = mapped_column(String(300), nullable=False, default="")
    payment_terms: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Last successful e-mail delivery; the full history is in oe_sales_send_log.
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_to: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    lines: Mapped[list[SalesLine]] = relationship(
        back_populates="document", order_by="SalesLine.line_no", cascade="all, delete-orphan", lazy="selectin"
    )
    payments: Mapped[list[SalesPayment]] = relationship(
        back_populates="invoice", order_by="SalesPayment.pay_date", cascade="all, delete-orphan", lazy="selectin"
    )

    @property
    def balance_due(self) -> Decimal:
        return (self.gross_total or Decimal(0)) - (self.amount_paid or Decimal(0))

    @property
    def is_overdue(self) -> bool:
        return (
            self.kind == "invoice"
            and self.due_date is not None
            and self.due_date < date.today()
            and self.balance_due > 0
            and self.status not in ("paid", "cancelled", "draft")
        )


class SalesLine(Base):
    __tablename__ = "oe_sales_line"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_sales_document.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    item_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    sku: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    qty: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal(1))
    unit_price: Mapped[Decimal] = mapped_column(Numeric(18, 4), nullable=False, default=Decimal(0))
    discount_pct: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False, default=Decimal(0))
    tax_rate: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False, default=Decimal(0))
    net: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    tax: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    gross: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))

    document: Mapped[SalesDocument] = relationship(back_populates="lines", lazy="raise_on_sql")

    # Set by SalesService.get() for quotes/orders; otherwise nothing was converted yet.
    @property
    def remaining_qty(self) -> Decimal:
        return self.__dict__.get("_remaining_qty", self.qty)

    @remaining_qty.setter
    def remaining_qty(self, value: Decimal) -> None:
        self.__dict__["_remaining_qty"] = value


class SalesPayment(Base):
    __tablename__ = "oe_sales_payment"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_sales_document.id", ondelete="CASCADE"), nullable=False, index=True
    )
    pay_date: Mapped[date] = mapped_column(Date, nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    method: Mapped[str] = mapped_column(String(32), nullable=False, default="bank_transfer")
    reference: Mapped[str] = mapped_column(String(128), nullable=False, default="")
    # Base units per one document-currency unit on the payment date (None for base-currency documents).
    fx_rate: Mapped[Decimal | None] = mapped_column(Numeric(20, 10), nullable=True)
    gl_entry_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)

    invoice: Mapped[SalesDocument] = relationship(back_populates="payments", lazy="raise_on_sql")


class SalesSequence(Base):
    __tablename__ = "oe_sales_sequence"
    __table_args__ = (UniqueConstraint("tenant_id", "kind", name="uq_oe_sales_sequence_tenant_kind"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    kind: Mapped[str] = mapped_column(String(16), nullable=False)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class SalesAccountMap(Base):
    __tablename__ = "oe_sales_account_map"
    __table_args__ = (UniqueConstraint("tenant_id", "role", name="uq_oe_sales_account_map_tenant_role"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    account_code: Mapped[str] = mapped_column(String(32), nullable=False)


class SalesSendLog(Base):
    __tablename__ = "oe_sales_send_log"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    document_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_sales_document.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sent_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sent_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    to_addr: Mapped[str] = mapped_column(String(255), nullable=False)
    cc: Mapped[list] = mapped_column(JSON, nullable=False, default=list)  # type: ignore[assignment]
    subject: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False)
    detail: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    backend: Mapped[str] = mapped_column(String(32), nullable=False, default="")


class SalesPaymentLink(Base):
    __tablename__ = "oe_sales_payment_link"
    __table_args__ = (UniqueConstraint("provider", "provider_ref", name="uq_oe_sales_payment_link_provider_ref"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    invoice_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_sales_document.id", ondelete="CASCADE"), nullable=False, index=True
    )
    provider: Mapped[str] = mapped_column(String(16), nullable=False)
    # Stripe Checkout Session id / Mollie payment id; the idempotency key for webhooks.
    provider_ref: Mapped[str] = mapped_column(String(128), nullable=False)
    url: Mapped[str] = mapped_column(String(1000), nullable=False)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="open")  # open|processing|paid|unapplied
    paid_amount: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    payment_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
