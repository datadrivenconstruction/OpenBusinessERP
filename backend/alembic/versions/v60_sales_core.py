"""Sales (order-to-cash) tables: documents, lines, payments, sequences, GL account map.

Fresh installs get these from the model declarations; tables that already exist are left alone.

Revision ID: v60_sales_core
Revises: v59_gl_core
"""

import sqlalchemy as sa
from alembic import op

revision = "v60_sales_core"
down_revision = "v59_gl_core"
branch_labels = None
depends_on = None

_TABLES = ("oe_sales_payment", "oe_sales_line", "oe_sales_document", "oe_sales_sequence", "oe_sales_account_map")


def _base(table: str) -> list:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
    ]


def _money(name: str) -> sa.Column:
    return sa.Column(name, sa.Numeric(18, 2), nullable=False, server_default="0")


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "oe_sales_document" not in existing:
        op.create_table(
            "oe_sales_document",
            *_base("oe_sales_document"),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("number", sa.String(32), nullable=False),
            sa.Column("status", sa.String(24), nullable=False, server_default="draft"),
            sa.Column("customer_id", sa.Uuid(), nullable=True),
            sa.Column("customer_name", sa.String(255), nullable=False, server_default=""),
            sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
            sa.Column("fx_rate", sa.Numeric(20, 10), nullable=False, server_default="1"),
            sa.Column("doc_date", sa.Date(), nullable=False),
            sa.Column("due_date", sa.Date(), nullable=True),
            sa.Column("source_id", sa.Uuid(), sa.ForeignKey("oe_sales_document.id", ondelete="SET NULL"), nullable=True),
            _money("net_total"),
            _money("tax_total"),
            _money("gross_total"),
            _money("amount_paid"),
            sa.Column("gl_entry_id", sa.Uuid(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(64), nullable=True),
            sa.UniqueConstraint("kind", "number", name="uq_oe_sales_document_kind_number"),
        )
        for col in ("kind", "number", "status", "customer_id", "source_id"):
            op.create_index(f"ix_oe_sales_document_{col}", "oe_sales_document", [col])

    if "oe_sales_line" not in existing:
        op.create_table(
            "oe_sales_line",
            *_base("oe_sales_line"),
            sa.Column("document_id", sa.Uuid(), sa.ForeignKey("oe_sales_document.id", ondelete="CASCADE"), nullable=False),
            sa.Column("line_no", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("sku", sa.String(64), nullable=False, server_default=""),
            sa.Column("description", sa.String(500), nullable=False, server_default=""),
            sa.Column("qty", sa.Numeric(18, 4), nullable=False, server_default="1"),
            sa.Column("unit_price", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("discount_pct", sa.Numeric(7, 4), nullable=False, server_default="0"),
            sa.Column("tax_rate", sa.Numeric(7, 4), nullable=False, server_default="0"),
            _money("net"),
            _money("tax"),
            _money("gross"),
        )
        op.create_index("ix_oe_sales_line_document_id", "oe_sales_line", ["document_id"])

    if "oe_sales_payment" not in existing:
        op.create_table(
            "oe_sales_payment",
            *_base("oe_sales_payment"),
            sa.Column("invoice_id", sa.Uuid(), sa.ForeignKey("oe_sales_document.id", ondelete="CASCADE"), nullable=False),
            sa.Column("pay_date", sa.Date(), nullable=False),
            sa.Column("amount", sa.Numeric(18, 2), nullable=False),
            sa.Column("method", sa.String(32), nullable=False, server_default="bank_transfer"),
            sa.Column("reference", sa.String(128), nullable=False, server_default=""),
            sa.Column("gl_entry_id", sa.Uuid(), nullable=True),
        )
        op.create_index("ix_oe_sales_payment_invoice_id", "oe_sales_payment", ["invoice_id"])

    if "oe_sales_sequence" not in existing:
        op.create_table(
            "oe_sales_sequence",
            *_base("oe_sales_sequence"),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("last_number", sa.Integer(), nullable=False, server_default="0"),
            sa.UniqueConstraint("kind", name="uq_oe_sales_sequence_kind"),
        )

    if "oe_sales_account_map" not in existing:
        op.create_table(
            "oe_sales_account_map",
            *_base("oe_sales_account_map"),
            sa.Column("role", sa.String(32), nullable=False),
            sa.Column("account_code", sa.String(32), nullable=False),
            sa.UniqueConstraint("role", name="uq_oe_sales_account_map_role"),
        )


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in _TABLES:
        if table in existing:
            op.drop_table(table)
