"""Online payment links per invoice (Stripe / Mollie).

Revision ID: v76_sales_payment_link
Revises: v75_payment_fx_rate
"""

import sqlalchemy as sa
from alembic import op

revision = "v76_sales_payment_link"
down_revision = "v75_payment_fx_rate"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("oe_sales_payment_link"):
        return
    op.create_table(
        "oe_sales_payment_link",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column(
            "invoice_id", sa.String(36), sa.ForeignKey("oe_sales_document.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("provider", sa.String(16), nullable=False),
        sa.Column("provider_ref", sa.String(128), nullable=False),
        sa.Column("url", sa.String(1000), nullable=False),
        sa.Column("amount", sa.Numeric(18, 2), nullable=False),
        sa.Column("currency", sa.String(3), nullable=False),
        sa.Column("status", sa.String(16), nullable=False, server_default="open"),
        sa.Column("paid_amount", sa.Numeric(18, 2), nullable=True),
        sa.Column("payment_id", sa.String(36), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_oe_sales_payment_link"),
        sa.UniqueConstraint("provider", "provider_ref", name="uq_oe_sales_payment_link_provider_ref"),
    )
    op.create_index("ix_oe_sales_payment_link_tenant_id", "oe_sales_payment_link", ["tenant_id"])
    op.create_index("ix_oe_sales_payment_link_invoice_id", "oe_sales_payment_link", ["invoice_id"])


def downgrade() -> None:
    op.drop_table("oe_sales_payment_link")
