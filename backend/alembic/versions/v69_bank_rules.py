"""Banking auto-categorisation rules.

Revision ID: v69_bank_rules
Revises: v68_sales_line_item_id
"""

import sqlalchemy as sa
from alembic import op

revision = "v69_bank_rules"
down_revision = "v68_sales_line_item_id"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.database import Base
    from app.modules.banking import models as _banking  # noqa: F401

    Base.metadata.create_all(bind=op.get_bind(), tables=[Base.metadata.tables["oe_bank_rule"]], checkfirst=True)


def downgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("oe_bank_rule"):
        op.drop_table("oe_bank_rule")
