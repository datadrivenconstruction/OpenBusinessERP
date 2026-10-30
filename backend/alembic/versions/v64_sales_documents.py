"""Sales document printing: recipient/delivery columns, credit-note kind, send log.

Revision ID: v64_sales_documents
Revises: v63_purchasing_core
"""

import sqlalchemy as sa
from alembic import op

revision = "v64_sales_documents"
down_revision = "v63_purchasing_core"
branch_labels = None
depends_on = None

_COLUMNS = (
    sa.Column("customer_address", sa.Text(), nullable=False, server_default=""),
    sa.Column("customer_vat_id", sa.String(50), nullable=False, server_default=""),
    sa.Column("customer_email", sa.String(255), nullable=False, server_default=""),
    sa.Column("language", sa.String(5), nullable=False, server_default=""),
    sa.Column("delivery_date", sa.Date(), nullable=True),
    sa.Column("delivery_end", sa.Date(), nullable=True),
    sa.Column("tax_note", sa.String(300), nullable=False, server_default=""),
)


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    tables = set(insp.get_table_names())
    if "oe_sales_document" in tables:
        have = {c["name"] for c in insp.get_columns("oe_sales_document")}
        for col in _COLUMNS:
            if col.name not in have:
                op.add_column("oe_sales_document", col.copy())
    if "oe_sales_send_log" not in tables:
        op.create_table(
            "oe_sales_send_log",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column(
                "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
            ),
            sa.Column(
                "updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
            ),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column(
                "document_id", sa.Uuid(), sa.ForeignKey("oe_sales_document.id", ondelete="CASCADE"), nullable=False
            ),
            sa.Column("sent_by", sa.String(64), nullable=True),
            sa.Column("sent_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("to_addr", sa.String(255), nullable=False),
            sa.Column("cc", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("subject", sa.String(255), nullable=False, server_default=""),
            sa.Column("status", sa.String(16), nullable=False),
            sa.Column("detail", sa.String(255), nullable=False, server_default=""),
            sa.Column("backend", sa.String(32), nullable=False, server_default=""),
            sa.PrimaryKeyConstraint("id", name="pk_oe_sales_send_log"),
        )
        op.create_index("ix_oe_sales_send_log_tenant_id", "oe_sales_send_log", ["tenant_id"])
        op.create_index("ix_oe_sales_send_log_document_id", "oe_sales_send_log", ["document_id"])


def downgrade() -> None:
    op.drop_table("oe_sales_send_log")
    for col in _COLUMNS:
        op.drop_column("oe_sales_document", col.name)
