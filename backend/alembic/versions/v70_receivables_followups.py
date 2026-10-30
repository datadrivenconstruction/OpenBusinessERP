"""Receivables follow-up log (customer notes and payment promises).

Revision ID: v70_receivables_followups
Revises: v69_bank_rules
"""

import sqlalchemy as sa
from alembic import op

revision = "v70_receivables_followups"
down_revision = "v69_bank_rules"
branch_labels = None
depends_on = None


def upgrade() -> None:
    from app.database import Base
    from app.modules.receivables import models as _receivables  # noqa: F401

    Base.metadata.create_all(bind=op.get_bind(), tables=[Base.metadata.tables["oe_ar_followup"]], checkfirst=True)


def downgrade() -> None:
    if "oe_ar_followup" in set(sa.inspect(op.get_bind()).get_table_names()):
        op.drop_table("oe_ar_followup")
