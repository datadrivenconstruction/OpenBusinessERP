"""Sales line item link, sales payment terms, purchasing line discounts.

Revision ID: v68_sales_line_item_id
Revises: v67_items_inventory_fields
"""

import sqlalchemy as sa
from alembic import op

revision = "v68_sales_line_item_id"
down_revision = "v67_items_inventory_fields"
branch_labels = None
depends_on = None

_COLS = {
    "oe_sales_line": [sa.Column("item_id", sa.Uuid(), nullable=True)],
    "oe_sales_document": [sa.Column("payment_terms", sa.String(64), nullable=False, server_default="")],
    "oe_purchasing_order_line": [sa.Column("discount_pct", sa.Numeric(7, 4), nullable=False, server_default="0")],
    "oe_purchasing_bill_line": [sa.Column("discount_pct", sa.Numeric(7, 4), nullable=False, server_default="0")],
}


def _have(table: str) -> set[str] | None:
    insp = sa.inspect(op.get_bind())
    return {c["name"] for c in insp.get_columns(table)} if insp.has_table(table) else None


def upgrade() -> None:
    for table, cols in _COLS.items():
        have = _have(table)
        if have is None:
            continue  # fresh install: table comes from the model declarations
        for col in cols:
            if col.name not in have:
                op.add_column(table, col.copy())
    if _have("oe_sales_line") is not None:
        op.create_index("ix_oe_sales_line_item_id", "oe_sales_line", ["item_id"], if_not_exists=True)


def downgrade() -> None:
    if _have("oe_sales_line") is not None:
        op.drop_index("ix_oe_sales_line_item_id", table_name="oe_sales_line", if_exists=True)
    for table, cols in _COLS.items():
        have = _have(table)
        for col in cols:
            if have and col.name in have:
                op.drop_column(table, col.name)
