"""Items: min stock, reorder quantity, default supplier, image and notes.

Revision ID: v67_items_inventory_fields
Revises: v66_appointments_core
"""

import sqlalchemy as sa
from alembic import op

revision = "v67_items_inventory_fields"
down_revision = "v66_appointments_core"
branch_labels = None
depends_on = None

_T = "oe_items_item"
_COLS = (
    sa.Column("min_stock", sa.Numeric(18, 4), nullable=False, server_default="0"),
    sa.Column("reorder_qty", sa.Numeric(18, 4), nullable=False, server_default="0"),
    sa.Column("default_supplier_id", sa.String(36), nullable=True),
    sa.Column("image_url", sa.String(500), nullable=False, server_default=""),
    sa.Column("notes", sa.Text(), nullable=False, server_default=""),
)


def _existing() -> set[str]:
    insp = sa.inspect(op.get_bind())
    if not insp.has_table(_T):
        return set()
    return {c["name"] for c in insp.get_columns(_T)}


def upgrade() -> None:
    have = _existing()
    if not have:
        return  # fresh install: table comes from the model declarations
    for col in _COLS:
        if col.name not in have:
            op.add_column(_T, col.copy())


def downgrade() -> None:
    have = _existing()
    for col in reversed(_COLS):
        if col.name in have:
            op.drop_column(_T, col.name)
