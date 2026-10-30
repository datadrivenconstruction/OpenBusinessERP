"""Data import wizard: jobs, written-record log (for undo) and saved mapping presets.

Fresh installs get these from the model declarations; tables that already exist are left alone.

Revision ID: v64_data_import
Revises: v63_purchasing_core
"""

import sqlalchemy as sa
from alembic import op

revision = "v64_data_import"
down_revision = "v63_purchasing_core"
branch_labels = None
depends_on = None

_TABLES = ("oe_data_import_record", "oe_data_import_preset", "oe_data_import_job")


def _base(table: str) -> list:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
    ]


def _json(name: str, default: str) -> sa.Column:
    return sa.Column(name, sa.JSON(), nullable=False, server_default=default)


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    t = "oe_data_import_job"
    if t not in existing:
        op.create_table(
            t, *_base(t),
            sa.Column("target", sa.String(32), nullable=False),
            sa.Column("filename", sa.String(255), nullable=False, server_default=""),
            sa.Column("status", sa.String(16), nullable=False, server_default="uploaded"),
            sa.Column("encoding", sa.String(32), nullable=False, server_default=""),
            sa.Column("delimiter", sa.String(4), nullable=False, server_default=""),
            _json("headers", "[]"), _json("rows", "[]"), _json("mapping", "{}"),
            _json("options", "{}"), _json("summary", "{}"),
            sa.Column("row_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("error", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(64), nullable=True),
        )
        for c in ("tenant_id", "target", "status"):
            op.create_index(f"ix_{t}_{c}", t, [c])
    t = "oe_data_import_record"
    if t not in existing:
        op.create_table(
            t, *_base(t),
            sa.Column("job_id", sa.Uuid(), sa.ForeignKey("oe_data_import_job.id", ondelete="CASCADE"), nullable=False),
            sa.Column("entity", sa.String(32), nullable=False),
            sa.Column("record_id", sa.Uuid(), nullable=False),
            sa.Column("action", sa.String(16), nullable=False, server_default="created"),
            sa.Column("row_no", sa.Integer(), nullable=False, server_default="0"),
        )
        for c in ("tenant_id", "job_id"):
            op.create_index(f"ix_{t}_{c}", t, [c])
    t = "oe_data_import_preset"
    if t not in existing:
        op.create_table(
            t, *_base(t),
            sa.Column("target", sa.String(32), nullable=False),
            sa.Column("name", sa.String(128), nullable=False),
            _json("mapping", "{}"),
        )
        for c in ("tenant_id", "target"):
            op.create_index(f"ix_{t}_{c}", t, [c])


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in _TABLES:
        if table in existing:
            op.drop_table(table)
