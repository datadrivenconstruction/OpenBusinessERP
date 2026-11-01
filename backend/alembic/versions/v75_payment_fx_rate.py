"""Payment-date FX rate on sales and purchasing payments.

Revision ID: v75_payment_fx_rate
Revises: v74_stock_inventory
"""

import sqlalchemy as sa
from alembic import op

revision = "v75_payment_fx_rate"
down_revision = "v74_stock_inventory"
branch_labels = None
depends_on = None

_TABLES = ("oe_sales_payment", "oe_purchasing_payment")


def _cols(table: str) -> set[str] | None:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table(table):
        return None
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    for t in _TABLES:
        cols = _cols(t)
        if cols is not None and "fx_rate" not in cols:
            with op.batch_alter_table(t) as b:
                b.add_column(sa.Column("fx_rate", sa.Numeric(20, 10), nullable=True))


def downgrade() -> None:
    for t in _TABLES:
        cols = _cols(t)
        if cols and "fx_rate" in cols:
            with op.batch_alter_table(t) as b:
                b.drop_column("fx_rate")
