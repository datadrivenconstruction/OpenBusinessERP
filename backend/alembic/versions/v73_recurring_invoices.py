"""Recurring invoice templates and their per-period runs.

Fresh installs get these from the model declarations; tables that already exist are left alone.

Revision ID: v73_recurring_invoices
Revises: v73_email_sent_markers
"""

import sqlalchemy as sa
from alembic import op

revision = "v73_recurring_invoices"
down_revision = "v73_email_sent_markers"
branch_labels = None
depends_on = None


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
        sa.Column("tenant_id", sa.String(36), nullable=False, server_default="default"),
    ]


def _index(table: str, *cols: str) -> None:
    for col in cols:
        op.create_index(f"ix_{table}_{col}", table, [col])


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "oe_recurring_invoice" not in existing:
        op.create_table(
            "oe_recurring_invoice",
            *_base("oe_recurring_invoice"),
            sa.Column("name", sa.String(255), nullable=False, server_default=""),
            sa.Column("status", sa.String(16), nullable=False, server_default="active"),
            sa.Column("customer_id", sa.String(36), nullable=True),
            sa.Column("customer_name", sa.String(255), nullable=False, server_default=""),
            sa.Column("customer_email", sa.String(255), nullable=False, server_default=""),
            sa.Column("customer_address", sa.Text(), nullable=False, server_default=""),
            sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
            sa.Column("lines", sa.JSON(), nullable=False),
            sa.Column("net_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("gross_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("interval", sa.String(16), nullable=False, server_default="monthly"),
            sa.Column("interval_count", sa.Integer(), nullable=False, server_default="1"),
            sa.Column("start_date", sa.Date(), nullable=False),
            sa.Column("end_date", sa.Date(), nullable=True),
            sa.Column("max_count", sa.Integer(), nullable=True),
            sa.Column("day_of_month", sa.Integer(), nullable=True),
            sa.Column("payment_terms_days", sa.Integer(), nullable=False, server_default="14"),
            sa.Column("period_index", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("generated_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("next_run_date", sa.Date(), nullable=True),
            sa.Column("auto_issue", sa.Boolean(), nullable=False, server_default=sa.true()),
            sa.Column("auto_send", sa.Boolean(), nullable=False, server_default=sa.false()),
            sa.Column("last_document_id", sa.String(36), nullable=True),
            sa.Column("last_run_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_error", sa.String(255), nullable=False, server_default=""),
            sa.Column("tag", sa.String(64), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(64), nullable=True),
        )
        _index("oe_recurring_invoice", "tenant_id", "status", "customer_id", "next_run_date", "tag")

    if "oe_recurring_run" not in existing:
        op.create_table(
            "oe_recurring_run",
            *_base("oe_recurring_run"),
            sa.Column(
                "template_id",
                sa.String(36),
                sa.ForeignKey("oe_recurring_invoice.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("period_date", sa.Date(), nullable=False),
            sa.Column("document_id", sa.String(36), nullable=True),
            sa.Column("document_number", sa.String(32), nullable=False, server_default=""),
            sa.Column("gross_total", sa.Numeric(18, 2), nullable=False, server_default="0"),
            sa.Column("status", sa.String(16), nullable=False, server_default="generated"),
            sa.Column("detail", sa.String(255), nullable=False, server_default=""),
            sa.Column("trigger", sa.String(16), nullable=False, server_default="schedule"),
            sa.UniqueConstraint("template_id", "period_date", name="uq_oe_recurring_run_template_period"),
        )
        _index("oe_recurring_run", "tenant_id", "template_id", "document_id")


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in ("oe_recurring_run", "oe_recurring_invoice"):
        if table in existing:
            op.drop_table(table)
