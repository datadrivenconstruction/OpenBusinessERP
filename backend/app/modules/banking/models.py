"""Banking ORM models.

Tables:
    oe_bank_account      - company bank account, linked to a GL account code.
    oe_bank_statement    - one imported file (format, counts).
    oe_bank_transaction  - statement line; unique per (tenant, account, dedupe_key).
    oe_bank_match        - one confirmed allocation of a line (invoice, bill, GL, write-off).
    oe_bank_partner_iban - counterparty IBANs learned from confirmed matches.
    oe_bank_settings     - per-tenant tolerance, date window and write-off account.
    oe_bank_rule         - auto-categorisation rules (counterparty/text → GL account).
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
LINE_STATUSES = ("unmatched", "partially_matched", "matched", "ignored")


class BankAccount(Base):
    __tablename__ = "oe_bank_account"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    iban: Mapped[str] = mapped_column(String(34), nullable=False, default="")
    bic: Mapped[str] = mapped_column(String(11), nullable=False, default="")
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    gl_account_code: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    # Balance before the first imported statement line; statement balance = opening + SUM(lines).
    opening_balance: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))
    opening_balance_date: Mapped[date | None] = mapped_column(Date, nullable=True)


class BankStatement(Base):
    __tablename__ = "oe_bank_statement"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_bank_account.id", ondelete="CASCADE"), nullable=False, index=True
    )
    filename: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    format: Mapped[str] = mapped_column(String(16), nullable=False)
    imported_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duplicate_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class BankTransaction(Base):
    __tablename__ = "oe_bank_transaction"
    __table_args__ = (
        UniqueConstraint("tenant_id", "account_id", "dedupe_key", name="uq_oe_bank_transaction_dedupe"),
    )

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    account_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_bank_account.id", ondelete="CASCADE"), nullable=False, index=True
    )
    statement_id: Mapped[uuid.UUID | None] = mapped_column(
        GUID(), ForeignKey("oe_bank_statement.id", ondelete="SET NULL"), nullable=True, index=True
    )
    booking_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    value_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="EUR")
    counterparty_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    counterparty_iban: Mapped[str] = mapped_column(String(34), nullable=False, default="")
    remittance: Mapped[str] = mapped_column(Text, nullable=False, default="")
    reference: Mapped[str] = mapped_column(String(140), nullable=False, default="")
    dedupe_key: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="unmatched", index=True)
    matched_amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal(0))

    matches: Mapped[list[BankMatch]] = relationship(
        back_populates="transaction", cascade="all, delete-orphan", lazy="selectin"
    )


class BankMatch(Base):
    __tablename__ = "oe_bank_match"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    transaction_id: Mapped[uuid.UUID] = mapped_column(
        GUID(), ForeignKey("oe_bank_transaction.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # sales_invoice | purchase_bill | gl_entry | write_off
    target_type: Mapped[str] = mapped_column(String(20), nullable=False)
    target_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True, index=True)
    target_number: Mapped[str] = mapped_column(String(64), nullable=False, default="")
    amount: Mapped[Decimal] = mapped_column(MONEY, nullable=False)
    gl_entry_id: Mapped[uuid.UUID | None] = mapped_column(GUID(), nullable=True)
    confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 3), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)

    transaction: Mapped[BankTransaction] = relationship(back_populates="matches", lazy="raise_on_sql")


class BankPartnerIban(Base):
    __tablename__ = "oe_bank_partner_iban"
    __table_args__ = (UniqueConstraint("tenant_id", "iban", "partner_key", name="uq_oe_bank_partner_iban"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    iban: Mapped[str] = mapped_column(String(34), nullable=False, index=True)
    partner_key: Mapped[str] = mapped_column(String(300), nullable=False)
    partner_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")


class BankSettings(Base):
    __tablename__ = "oe_bank_settings"
    __table_args__ = (UniqueConstraint("tenant_id", name="uq_oe_bank_settings_tenant"),)

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    amount_tolerance: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("0.05"))
    date_window_days: Mapped[int] = mapped_column(Integer, nullable=False, default=30)
    writeoff_account_code: Mapped[str] = mapped_column(String(32), nullable=False, default="")
    writeoff_max: Mapped[Decimal] = mapped_column(MONEY, nullable=False, default=Decimal("5.00"))


class BankRule(Base):
    """Auto-categorisation rule: lines whose text matches are booked to a GL account."""

    __tablename__ = "oe_bank_rule"

    tenant_id: Mapped[str] = mapped_column(String(36), nullable=False, default=DEFAULT_TENANT, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    # counterparty | text | iban | any
    match_field: Mapped[str] = mapped_column(String(16), nullable=False, default="any")
    pattern: Mapped[str] = mapped_column(String(200), nullable=False)
    # in | out | any
    direction: Mapped[str] = mapped_column(String(8), nullable=False, default="any")
    min_amount: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    max_amount: Mapped[Decimal | None] = mapped_column(MONEY, nullable=True)
    account_code: Mapped[str] = mapped_column(String(32), nullable=False)
    memo: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    priority: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    hit_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
