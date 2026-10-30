"""GL journal entry attachments.

Revision ID: v71_gl_attachments
Revises: v70_receivables_followups
"""

import sqlalchemy as sa
from alembic import op

revision = "v71_gl_attachments"
down_revision = "v70_receivables_followups"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "oe_gl_attachment" in set(sa.inspect(op.get_bind()).get_table_names()):
        return
    op.create_table(
        "oe_gl_attachment",
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column("tenant_id", sa.String(36), nullable=False),
        sa.Column(
            "entry_id", sa.String(36), sa.ForeignKey("oe_gl_journal_entry.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("content_type", sa.String(128), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("data", sa.LargeBinary(), nullable=False),
        sa.Column("uploaded_by", sa.String(64), nullable=True),
        sa.PrimaryKeyConstraint("id", name="pk_oe_gl_attachment"),
    )
    op.create_index("ix_oe_gl_attachment_tenant_id", "oe_gl_attachment", ["tenant_id"])
    op.create_index("ix_oe_gl_attachment_entry_id", "oe_gl_attachment", ["entry_id"])


def downgrade() -> None:
    op.drop_table("oe_gl_attachment")
