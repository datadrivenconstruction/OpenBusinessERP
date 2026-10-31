"""Recurring invoice ORM models.

Tables:
    oe_recurring_invoice - template: customer, lines, schedule, auto-issue/auto-send.
    oe_recurring_run     - one row per template and period; the unique key is the idempotency guard.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import JSON, Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.database import GUID, Base
from app.modules.gl.models import DEFAULT_TENANT

INTERVALS: tuple[str, ...] = ("weekly", "monthly", "quarterly", "yearly")
STATUSES: tuple[str, ...] = ("active", "paused", "ended")


class RecurringInvoice(Base):
    __tablename__ = "oe_recurring_invoice"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="active", index=True)
    customer_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    customer_email: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    customer_address: Mapped[str] = mapped_column(Text, nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    # [{description, sku, qty, unit_price, discount_pct, tax_rate, item_id}] as strings.
    lines: Mapped[list] = mapped_column(JSON, nullable=False, default=list)  # type: ignore[assignment]
    net_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal(0))
    gross_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal(0))
    notes: Mapped[str] = mapped_column(Text, nullable=False, default="")
    interval: Mapped[str] = mapped_column(String(16), nullable=False, default="monthly")
    interval_count: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    max_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # 1..31 or None (= day of start_date); clamped to the month's last day.
    day_of_month: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payment_terms_days: Mapped[int] = mapped_column(Integer, nullable=False, default=14)
    # Periods consumed (generated or skipped on resume); next_run_date = occurrence(period_index).
    period_index: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    generated_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    next_run_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    auto_issue: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    auto_send: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_document_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_sales_document.id", ondelete="SET NULL"), nullable=True
    )
    last_run_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    tag: Mapped[str] = mapped_column(String(64), nullable=False, default="", index=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class RecurringRun(Base):
    __tablename__ = "oe_recurring_run"
    __table_args__ = (UniqueConstraint("template_id", "period_date", name="uq_oe_recurring_run_template_period"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    template_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_recurring_invoice.id", ondelete="CASCADE"), nullable=False, index=True
    )
    period_date: Mapped[date] = mapped_column(Date, nullable=False)
    # Sales document lives in oe_sales_document; plain GUID like other cross-module links.
    document_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_sales_document.id", ondelete="SET NULL"), nullable=True, index=True
    )
    document_number: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    gross_total: Mapped[Decimal] = mapped_column(Numeric(18, 2), nullable=False, default=Decimal(0))
    # generated | issued | sent | send_failed | failed
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="generated")
    detail: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    trigger: Mapped[str] = mapped_column(String(16), nullable=False, default="schedule")
