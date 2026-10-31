"""Sent markers on sales documents and dunning letters.

Revision ID: v73_email_sent_markers
Revises: v72_bank_opening_balance
"""

import sqlalchemy as sa
from alembic import op

revision = "v73_email_sent_markers"
down_revision = "v72_bank_opening_balance"
branch_labels = None
depends_on = None

TABLES = ("oe_sales_document", "oe_dunning_letter")


def _cols(table: str) -> set[str]:
    return {c["name"] for c in sa.inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    for table in TABLES:
        cols = _cols(table)
        with op.batch_alter_table(table) as b:
            if "sent_at" not in cols:
                b.add_column(sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True))
            if "sent_to" not in cols:
                b.add_column(sa.Column("sent_to", sa.String(255), nullable=False, server_default=""))


def downgrade() -> None:
    for table in TABLES:
        cols = _cols(table)
        with op.batch_alter_table(table) as b:
            for col in ("sent_to", "sent_at"):
                if col in cols:
                    b.drop_column(col)
