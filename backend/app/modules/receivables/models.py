"""Receivables ORM models.

Tables:
    oe_dunning_level     - per-tenant dunning levels (days after due, fee, own texts).
    oe_dunning_settings  - interest / fee switches (both off by default).
    oe_dunning_block     - customers excluded from dunning.
    oe_dunning_run       - one proposal run.
    oe_dunning_letter    - a proposed letter/email draft; never sent by the system.
    oe_ar_followup       - per-customer notes and payment promises.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import GUID, Base
from app.modules.gl.models import DEFAULT_TENANT

MONEY = Numeric(18, 2)


class DunningLevel(Base):
    __tablename__ = "oe_dunning_level"
    __table_args__ = (UniqueConstraint("tenant_id", "level", name="uq_oe_dunning_level_tenant_level"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    days_after_due: Mapped[int] = mapped_column(Integer, nullable=False)
    fee: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    subject: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")


class DunningSettings(Base):
    __tablename__ = "oe_dunning_settings"
    __table_args__ = (UniqueConstraint("tenant_id", name="uq_oe_dunning_settings_tenant"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    fees_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    interest_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    interest_rate_pct: Mapped[Decimal] = mapped_column(Numeric(7, 4), nullable=False, default=Decimal(0))
    min_days_between: Mapped[int] = mapped_column(Integer, nullable=False, default=7)


class DunningBlock(Base):
    __tablename__ = "oe_dunning_block"
    __table_args__ = (UniqueConstraint("tenant_id", "partner_key", name="uq_oe_dunning_block_tenant_partner"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    partner_key: Mapped[str] = mapped_column(String(300), nullable=False)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    reason: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class DunningRun(Base):
    __tablename__ = "oe_dunning_run"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    run_date: Mapped[date] = mapped_column(Date, nullable=False)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    letters: Mapped[list[DunningLetter]] = relationship(
        back_populates="run", cascade="all, delete-orphan", lazy="selectin", order_by="DunningLetter.customer_name"
    )


class DunningLetter(Base):
    __tablename__ = "oe_dunning_letter"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    run_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_dunning_run.id", ondelete="CASCADE"), nullable=False, index=True
    )
    invoice_id: Mapped[uuid.UUID] = mapped_column(GUID(), nullable=False, index=True)
    invoice_number: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    partner_key: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    letter_date: Mapped[date] = mapped_column(Date, nullable=False)
    days_overdue: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    outstanding: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    fee: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    interest: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    channel: Mapped[str] = mapped_column(String(10), nullable=False, default="letter")
    subject: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    body: Mapped[str] = mapped_column(Text, nullable=False, default="")
    # draft -> approved | discarded | sent. ``sent`` only after a successful user-triggered e-mail.
    status: Mapped[str] = mapped_column(String(12), nullable=False, default="draft", index=True)
    decided_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    sent_to: Mapped[str] = mapped_column(String(255), nullable=False, default="")

    run: Mapped[DunningRun] = relationship(back_populates="letters", lazy="raise_on_sql")


class ArFollowUp(Base):
    """Collector's log per customer: free notes and payment promises."""

    __tablename__ = "oe_ar_followup"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    partner_key: Mapped[str] = mapped_column(String(300), nullable=False, index=True)
    customer_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    kind: Mapped[str] = mapped_column(String(10), nullable=False, default="note")  # note | promise
    text: Mapped[str] = mapped_column(Text, nullable=False, default="")
    invoice_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    invoice_number: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    promised_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    promised_amount: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    # promise: open -> kept | broken | cancelled; notes keep "".
    status: Mapped[str] = mapped_column(String(10), nullable=False, default="")
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
