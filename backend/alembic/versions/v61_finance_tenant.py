"""Tenant isolation for GL and sales: tenant_id on every table, per-tenant uniques.

Existing rows are backfilled to the single shared company tenant ``default``.

Revision ID: v61_finance_tenant
Revises: v60_sales_core
"""

import sqlalchemy as sa
from alembic import op

revision = "v61_finance_tenant"
down_revision = "v60_sales_core"
branch_labels = None
depends_on = None

_TABLES = (
    "oe_gl_account",
    "oe_gl_fiscal_year",
    "oe_gl_period",
    "oe_gl_journal_entry",
    "oe_gl_journal_line",
    "oe_sales_document",
    "oe_sales_line",
    "oe_sales_payment",
    "oe_sales_sequence",
    "oe_sales_account_map",
)
# table -> (old unique columns, new unique name)
_UNIQUES = {
    "oe_gl_account": (["code"], "uq_oe_gl_account_tenant_code"),
    "oe_gl_fiscal_year": (["name"], "uq_oe_gl_fiscal_year_tenant_name"),
    "oe_sales_document": (["kind", "number"], "uq_oe_sales_document_tenant_kind_number"),
    "oe_sales_sequence": (["kind"], "uq_oe_sales_sequence_tenant_kind"),
    "oe_sales_account_map": (["role"], "uq_oe_sales_account_map_tenant_role"),
}


# data-rewrite-ack: table=oe_gl_account growth=bounded rows=chart of accounts, configured once per company
# data-rewrite-ack: table=oe_gl_fiscal_year growth=bounded rows=one row per fiscal year
# data-rewrite-ack: table=oe_gl_period growth=bounded rows=accounting periods, a dozen per fiscal year
# data-rewrite-ack: table=oe_gl_journal_entry growth=tenure rows=one row per posted journal entry
# data-rewrite-ack: table=oe_gl_journal_line growth=tenure rows=one row per journal line, several per entry
# data-rewrite-ack: table=oe_sales_document growth=tenure rows=one row per quote, order or invoice
# data-rewrite-ack: table=oe_sales_line growth=tenure rows=one row per document line
# data-rewrite-ack: table=oe_sales_payment growth=tenure rows=one row per recorded payment
# data-rewrite-ack: table=oe_sales_sequence growth=bounded rows=one numbering counter per document kind
# data-rewrite-ack: table=oe_sales_account_map growth=bounded rows=one GL mapping per posting role# boot-repair: gap - backfills tenant_id to the default company tenant; on an install that never runs alembic the boot heal adds the column empty, so pre-existing GL and sales rows keep tenant_id NULL
def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())
    tenant = "default"  # app.core.tenant_scope.DEFAULT_COMPANY_TENANT
    # Iterate the literal tuple so the data-rewrite guard can name each table.
    for table in _TABLES:
        if table not in existing:
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if "tenant_id" in cols:
            continue
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("tenant_id", sa.String(36), nullable=True))
        bind.execute(sa.text(f"UPDATE {table} SET tenant_id = :t"), {"t": tenant})
        with op.batch_alter_table(table) as batch:
            batch.alter_column("tenant_id", existing_type=sa.String(36), nullable=False)
            batch.create_index(f"ix_{table}_tenant_id", ["tenant_id"])
            if table in _UNIQUES:
                old_cols, new_name = _UNIQUES[table]
                for uq in insp.get_unique_constraints(table):
                    if uq["column_names"] == old_cols and uq.get("name"):
                        batch.drop_constraint(uq["name"], type_="unique")
                batch.create_unique_constraint(new_name, ["tenant_id", *old_cols])
            if table == "oe_gl_period":
                if any(ix["name"] == "ix_oe_gl_period_dates" for ix in insp.get_indexes(table)):
                    batch.drop_index("ix_oe_gl_period_dates")
                batch.create_index("ix_oe_gl_period_tenant_dates", ["tenant_id", "start_date", "end_date"])


def downgrade() -> None:
    insp = sa.inspect(op.get_bind())
    existing = set(insp.get_table_names())
    for table in _TABLES:
        if table not in existing or "tenant_id" not in {c["name"] for c in insp.get_columns(table)}:
            continue
        with op.batch_alter_table(table) as batch:
            if table in _UNIQUES:
                old_cols, new_name = _UNIQUES[table]
                batch.drop_constraint(new_name, type_="unique")
                batch.create_unique_constraint(f"uq_{table}_{'_'.join(old_cols)}", old_cols)
            if table == "oe_gl_period":
                batch.drop_index("ix_oe_gl_period_tenant_dates")
                batch.create_index("ix_oe_gl_period_dates", ["start_date", "end_date"])
            batch.drop_index(f"ix_{table}_tenant_id")
            batch.drop_column("tenant_id")
