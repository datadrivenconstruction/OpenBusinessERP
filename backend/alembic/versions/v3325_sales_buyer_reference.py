"""Sales document buyer reference (Leitweg-ID) for the e-invoice export.

Revision ID: v3325_sales_buyer_reference
Revises: v76_sales_payment_link
"""

import sqlalchemy as sa
from alembic import op

revision = "v3325_sales_buyer_reference"
down_revision = "v76_sales_payment_link"
branch_labels = None
depends_on = None

_TABLE = "oe_sales_document"


def _columns() -> set[str] | None:
    insp = sa.inspect(op.get_bind())
    return {c["name"] for c in insp.get_columns(_TABLE)} if insp.has_table(_TABLE) else None


def upgrade() -> None:
    have = _columns()
    if have is None or "buyer_reference" in have:
        return  # fresh install: the column comes from the model declaration
    op.add_column(_TABLE, sa.Column("buyer_reference", sa.String(100), nullable=False, server_default=""))


def downgrade() -> None:
    have = _columns()
    if have is not None and "buyer_reference" in have:
        op.drop_column(_TABLE, "buyer_reference")
