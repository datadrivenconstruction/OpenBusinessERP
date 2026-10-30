"""Banking (accounts, statements, lines, matches) and receivables dunning tables.

Fresh installs get these from the model declarations; tables that already exist are left alone.

Revision ID: v65_banking_receivables
Revises: v64_data_import, v64_sales_documents
"""

import sqlalchemy as sa
from alembic import op

revision = "v65_banking_receivables"
down_revision = ("v64_data_import", "v64_sales_documents")
branch_labels = None
depends_on = None

# Creation order respects foreign keys; drop runs in reverse.
_TABLES = (
    "oe_bank_account",
    "oe_bank_statement",
    "oe_bank_transaction",
    "oe_bank_match",
    "oe_bank_partner_iban",
    "oe_bank_settings",
    "oe_dunning_level",
    "oe_dunning_settings",
    "oe_dunning_block",
    "oe_dunning_run",
    "oe_dunning_letter",
)


def upgrade() -> None:
    from app.database import Base
    from app.modules.banking import models as _banking  # noqa: F401
    from app.modules.receivables import models as _receivables  # noqa: F401

    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, tables=[Base.metadata.tables[t] for t in _TABLES], checkfirst=True)


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in reversed(_TABLES):
        if table in existing:
            op.drop_table(table)
