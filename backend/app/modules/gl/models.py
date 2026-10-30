# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""General Ledger ORM models.

Tables:
    oe_gl_account       - chart of accounts (hierarchical via parent_id).
    oe_gl_fiscal_year   - fiscal year; owns periods and the entry number sequence.
    oe_gl_period        - accounting period (open/closed).
    oe_gl_journal_entry - journal entry header (draft/posted/reversed).
    oe_gl_journal_line  - one debit or credit line, in txn and base currency.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal

from sqlalchemy import (
    Boolean,
    Date,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.tenant_scope import DEFAULT_COMPANY_TENANT as DEFAULT_TENANT
from app.database import GUID, Base

ACCOUNT_TYPES: tuple[str, ...] = ("asset", "liability", "equity", "income", "expense")
ENTRY_DRAFT = "draft"
ENTRY_POSTED = "posted"
ENTRY_REVERSED = "reversed"
PERIOD_OPEN = "open"
PERIOD_CLOSED = "closed"

MONEY = Numeric(18, 2)


class GLAccount(Base):
    __tablename__ = "oe_gl_account"
    __table_args__ = (UniqueConstraint("tenant_id", "code", name="uq_oe_gl_account_tenant_code"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    code: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    account_type: Mapped[str] = mapped_column(String(16), nullable=False)
    parent_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_gl_account.id", ondelete="SET NULL"), nullable=True, index=True
    )
    currency: Mapped[str | None] = mapped_column(String(3), nullable=True)
    is_postable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    template: Mapped[str | None] = mapped_column(String(32), nullable=True)


class GLFiscalYear(Base):
    __tablename__ = "oe_gl_fiscal_year"
    __table_args__ = (UniqueConstraint("tenant_id", "name", name="uq_oe_gl_fiscal_year_tenant_name"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=PERIOD_OPEN)
    last_number: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    periods: Mapped[list[GLPeriod]] = relationship(
        back_populates="fiscal_year",
        order_by="GLPeriod.start_date",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class GLPeriod(Base):
    __tablename__ = "oe_gl_period"
    __table_args__ = (Index("ix_oe_gl_period_tenant_dates", "tenant_id", "start_date", "end_date"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    fiscal_year_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_gl_fiscal_year.id", ondelete="CASCADE"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(32), nullable=False)
    start_date: Mapped[date] = mapped_column(Date, nullable=False)
    end_date: Mapped[date] = mapped_column(Date, nullable=False)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=PERIOD_OPEN)

    fiscal_year: Mapped[GLFiscalYear] = relationship(back_populates="periods", lazy="raise_on_sql")


class GLJournalEntry(Base):
    __tablename__ = "oe_gl_journal_entry"
    __table_args__ = (
        UniqueConstraint("fiscal_year_id", "seq", name="uq_oe_gl_entry_fy_seq"),
        Index("ix_oe_gl_entry_source", "source_type", "source_id"),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    number: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    seq: Mapped[int | None] = mapped_column(Integer, nullable=True)
    entry_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    period_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_gl_period.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    fiscal_year_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_gl_fiscal_year.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False)
    base_currency: Mapped[str] = mapped_column(String(3), nullable=False)
    fx_rate: Mapped[Decimal] = mapped_column(Numeric(20, 10), nullable=False, default=Decimal(1))
    status: Mapped[str] = mapped_column(String(16), nullable=False, default=ENTRY_DRAFT, index=True)
    source_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    source_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    memo: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reversal_of_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_gl_journal_entry.id", ondelete="RESTRICT"), nullable=True
    )
    reversed_by_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    lines: Mapped[list[GLJournalLine]] = relationship(
        back_populates="entry",
        order_by="GLJournalLine.line_no",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class GLJournalLine(Base):
    __tablename__ = "oe_gl_journal_line"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    entry_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_gl_journal_entry.id", ondelete="CASCADE"), nullable=False, index=True
    )
    line_no: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    account_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_gl_account.id", ondelete="RESTRICT"), nullable=False, index=True
    )
    description: Mapped[str] = mapped_column(String(500), nullable=False, default="")
    debit: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    credit: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    base_debit: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    base_credit: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    tax_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    cost_center: Mapped[str | None] = mapped_column(String(64), nullable=True)
    project_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)

    entry: Mapped[GLJournalEntry] = relationship(back_populates="lines", lazy="raise_on_sql")


class GLAttachment(Base):
    """Receipt, invoice scan or contract backing a journal entry."""

    __tablename__ = "oe_gl_attachment"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    entry_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_gl_journal_entry.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False)
    content_type: Mapped[str] = mapped_column(String(128), nullable=False, default="application/octet-stream")
    size: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    data: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
