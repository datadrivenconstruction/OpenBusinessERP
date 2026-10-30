"""General Ledger core tables: accounts, fiscal years, periods, journal entries and lines.

Fresh installs get these from the model declarations; this revision covers
explicit Alembic upgrades. Tables that already exist are left alone.

Revision ID: v59_gl_core
Revises: v58_owner_list_indexes
"""

import sqlalchemy as sa
from alembic import op

revision = "v59_gl_core"
down_revision = "v58_owner_list_indexes"
branch_labels = None
depends_on = None

_TABLES = ("oe_gl_journal_line", "oe_gl_journal_entry", "oe_gl_period", "oe_gl_fiscal_year", "oe_gl_account")


def _base(table: str) -> list:
    return [
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
    ]


def _money(name: str) -> sa.Column:
    return sa.Column(name, sa.Numeric(18, 2), nullable=False, server_default="0")


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "oe_gl_account" not in existing:
        op.create_table(
            "oe_gl_account",
            *_base("oe_gl_account"),
            sa.Column("code", sa.String(32), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("account_type", sa.String(16), nullable=False),
            sa.Column(
                "parent_id", sa.String(36), sa.ForeignKey("oe_gl_account.id", ondelete="SET NULL"), nullable=True
            ),
            sa.Column("currency", sa.String(3), nullable=True),
            sa.Column("is_postable", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("template", sa.String(32), nullable=True),
            sa.UniqueConstraint("code", name="uq_oe_gl_account_code"),
        )
        op.create_index("ix_oe_gl_account_code", "oe_gl_account", ["code"])
        op.create_index("ix_oe_gl_account_parent_id", "oe_gl_account", ["parent_id"])

    if "oe_gl_fiscal_year" not in existing:
        op.create_table(
            "oe_gl_fiscal_year",
            *_base("oe_gl_fiscal_year"),
            sa.Column("name", sa.String(32), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="open"),
            sa.Column("last_number", sa.Integer(), nullable=False, server_default="0"),
            sa.UniqueConstraint("name", name="uq_oe_gl_fiscal_year_name"),
        )

    if "oe_gl_period" not in existing:
        op.create_table(
            "oe_gl_period",
            *_base("oe_gl_period"),
            sa.Column(
                "fiscal_year_id",
                sa.String(36),
                sa.ForeignKey("oe_gl_fiscal_year.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("name", sa.String(32), nullable=False),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=False),
            sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        )
        op.create_index("ix_oe_gl_period_fiscal_year_id", "oe_gl_period", ["fiscal_year_id"])
        op.create_index("ix_oe_gl_period_dates", "oe_gl_period", ["start_date", "end_date"])

    if "oe_gl_journal_entry" not in existing:
        op.create_table(
            "oe_gl_journal_entry",
            *_base("oe_gl_journal_entry"),
            sa.Column("number", sa.String(32), nullable=True),
            sa.Column("seq", sa.Integer(), nullable=True),
            sa.Column("entry_date", sa.Date(), nullable=False),
            sa.Column(
                "period_id", sa.String(36), sa.ForeignKey("oe_gl_period.id", ondelete="RESTRICT"), nullable=False
            ),
            sa.Column(
                "fiscal_year_id",
                sa.String(36),
                sa.ForeignKey("oe_gl_fiscal_year.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("currency", sa.String(3), nullable=False),
            sa.Column("base_currency", sa.String(3), nullable=False),
            sa.Column("fx_rate", sa.Numeric(20, 10), nullable=False, server_default="1"),
            sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
            sa.Column("source_type", sa.String(64), nullable=True),
            sa.Column("source_id", sa.String(64), nullable=True),
            sa.Column("memo", sa.Text(), nullable=False, server_default=""),
            sa.Column(
                "reversal_of_id",
                sa.String(36),
                sa.ForeignKey("oe_gl_journal_entry.id", ondelete="RESTRICT"),
                nullable=True,
            ),
            sa.Column("reversed_by_id", sa.String(36), nullable=True),
            sa.Column("created_by", sa.String(64), nullable=True),
            sa.UniqueConstraint("fiscal_year_id", "seq", name="uq_oe_gl_entry_fy_seq"),
        )
        for col in ("number", "entry_date", "period_id", "fiscal_year_id", "status"):
            op.create_index(f"ix_oe_gl_journal_entry_{col}", "oe_gl_journal_entry", [col])
        op.create_index("ix_oe_gl_entry_source", "oe_gl_journal_entry", ["source_type", "source_id"])

    if "oe_gl_journal_line" not in existing:
        op.create_table(
            "oe_gl_journal_line",
            *_base("oe_gl_journal_line"),
            sa.Column(
                "entry_id", sa.String(36), sa.ForeignKey("oe_gl_journal_entry.id", ondelete="CASCADE"), nullable=False
            ),
            sa.Column("line_no", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "account_id", sa.String(36), sa.ForeignKey("oe_gl_account.id", ondelete="RESTRICT"), nullable=False
            ),
            sa.Column("description", sa.String(500), nullable=False, server_default=""),
            _money("debit"),
            _money("credit"),
            _money("base_debit"),
            _money("base_credit"),
            sa.Column("tax_code", sa.String(32), nullable=True),
            sa.Column("cost_center", sa.String(64), nullable=True),
            sa.Column("project_id", sa.String(36), nullable=True),
        )
        for col in ("entry_id", "account_id", "project_id"):
            op.create_index(f"ix_oe_gl_journal_line_{col}", "oe_gl_journal_line", [col])


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in _TABLES:
        if table in existing:
            op.drop_table(table)
