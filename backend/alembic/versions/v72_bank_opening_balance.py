"""Bank account opening balance.

Revision ID: v72_bank_opening_balance
Revises: v71_gl_attachments
"""

import sqlalchemy as sa
from alembic import op

revision = "v72_bank_opening_balance"
down_revision = "v71_gl_attachments"
branch_labels = None
depends_on = None


def _cols() -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns("oe_bank_account")}


def upgrade() -> None:
    cols = _cols()
    with op.batch_alter_table("oe_bank_account") as b:
        if "opening_balance" not in cols:
            b.add_column(sa.Column("opening_balance", sa.Numeric(18, 2), nullable=False, server_default="0"))
        if "opening_balance_date" not in cols:
            b.add_column(sa.Column("opening_balance_date", sa.Date(), nullable=True))


def downgrade() -> None:
    cols = _cols()
    with op.batch_alter_table("oe_bank_account") as b:
        if "opening_balance_date" in cols:
            b.drop_column("opening_balance_date")
        if "opening_balance" in cols:
            b.drop_column("opening_balance")
