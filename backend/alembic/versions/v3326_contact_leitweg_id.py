"""Default Leitweg-ID on the contact, prefilled onto sales documents.

Revision ID: v3326_contact_leitweg_id
Revises: v3325_sales_buyer_reference
"""

import sqlalchemy as sa
from alembic import op

revision = "v3326_contact_leitweg_id"
down_revision = "v3325_sales_buyer_reference"
branch_labels = None
depends_on = None

_TABLE = "oe_contacts_contact"


def _columns() -> set[str] | None:
    insp = sa.inspect(op.get_bind())
    return {c["name"] for c in insp.get_columns(_TABLE)} if insp.has_table(_TABLE) else None


def upgrade() -> None:
    have = _columns()
    if have is None or "leitweg_id" in have:
        return  # fresh install: the column comes from the model declaration
    op.add_column(_TABLE, sa.Column("leitweg_id", sa.String(46), nullable=True))


def downgrade() -> None:
    have = _columns()
    if have is not None and "leitweg_id" in have:
        op.drop_column(_TABLE, "leitweg_id")
