"""Appointments: settings, services, resources, working hours, exceptions, bookings, reminder outbox.

Fresh installs get these from the model declarations; tables that already exist are left alone.

Revision ID: v66_appointments_core
Revises: v65_banking_receivables
"""

import sqlalchemy as sa
from alembic import op

revision = "v66_appointments_core"
down_revision = "v65_banking_receivables"
branch_labels = None
depends_on = None

_TABLES = (
    "oe_appointments_reminder",
    "oe_appointments_booking",
    "oe_appointments_exception",
    "oe_appointments_hours",
    "oe_appointments_resource",
    "oe_appointments_service",
    "oe_appointments_settings",
)


def _base(table: str) -> list:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
    ]


def _str(name: str, n: int, default: str = "") -> sa.Column:
    return sa.Column(name, sa.String(n), nullable=False, server_default=default)


def _int(name: str, default: int) -> sa.Column:
    return sa.Column(name, sa.Integer(), nullable=False, server_default=str(default))


def _flag(name: str, default: bool) -> sa.Column:
    return sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.true() if default else sa.false())


def _index(table: str, *cols: str) -> None:
    for col in cols:
        op.create_index(f"ix_{table}_{col}", table, [col])


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    t = "oe_appointments_settings"
    if t not in existing:
        op.create_table(
            t, *_base(t),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            _str("public_title", 255), _flag("online_enabled", False), sa.Column("slug", sa.String(80), nullable=False),
            _flag("auto_confirm", False), _str("privacy_url", 500), _int("slot_step_min", 15),
            _int("min_notice_hours", 2), _int("max_days_ahead", 60), _int("retention_days", 0),
            _flag("reminders_enabled", False), _int("reminder_hours", 24), _str("timezone", 64, "Europe/Berlin"),
            sa.UniqueConstraint("tenant_id", name="uq_oe_appointments_settings_tenant_id"),
            sa.UniqueConstraint("slug", name="uq_oe_appointments_settings_slug"),
        )

    t = "oe_appointments_service"
    if t not in existing:
        op.create_table(
            t, *_base(t),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            _int("duration_min", 30), _int("buffer_before_min", 0), _int("buffer_after_min", 0),
            sa.Column("price", sa.Numeric(18, 4), nullable=False, server_default="0"),
            _str("currency", 3, "EUR"),
            sa.Column("item_id", sa.Uuid(), sa.ForeignKey("oe_items_item.id", ondelete="SET NULL"), nullable=True),
            _str("resource_kind", 16, "staff"),
            sa.Column("resource_ids", sa.JSON(), nullable=False, server_default="[]"),
            _str("color", 16), _flag("online", True), _flag("active", True),
        )
        _index(t, "tenant_id")

    t = "oe_appointments_resource"
    if t not in existing:
        op.create_table(
            t, *_base(t),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            _str("kind", 16, "staff"), _str("color", 16), _flag("active", True), _int("sort_order", 0),
        )
        _index(t, "tenant_id")

    t = "oe_appointments_hours"
    if t not in existing:
        op.create_table(
            t, *_base(t),
            sa.Column("resource_id", sa.Uuid(), sa.ForeignKey("oe_appointments_resource.id", ondelete="CASCADE"),
                      nullable=False),
            sa.Column("weekday", sa.Integer(), nullable=False),
            sa.Column("start_min", sa.Integer(), nullable=False),
            sa.Column("end_min", sa.Integer(), nullable=False),
            _str("kind", 8, "work"),
        )
        _index(t, "resource_id")

    t = "oe_appointments_exception"
    if t not in existing:
        op.create_table(
            t, *_base(t),
            sa.Column("resource_id", sa.Uuid(), sa.ForeignKey("oe_appointments_resource.id", ondelete="CASCADE"),
                      nullable=False),
            sa.Column("day", sa.Date(), nullable=False),
            _str("kind", 8, "closed"),
            sa.Column("start_min", sa.Integer(), nullable=True),
            sa.Column("end_min", sa.Integer(), nullable=True),
            _str("label", 255),
        )
        _index(t, "resource_id", "day")

    t = "oe_appointments_booking"
    if t not in existing:
        op.create_table(
            t, *_base(t),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("service_id", sa.Uuid(), sa.ForeignKey("oe_appointments_service.id", ondelete="RESTRICT"),
                      nullable=False),
            sa.Column("resource_id", sa.Uuid(), sa.ForeignKey("oe_appointments_resource.id", ondelete="RESTRICT"),
                      nullable=False),
            sa.Column("contact_id", sa.Uuid(), nullable=True),
            _str("client_name", 255), _str("client_email", 255), _str("client_phone", 64),
            sa.Column("start_at", sa.DateTime(timezone=False), nullable=False),
            sa.Column("end_at", sa.DateTime(timezone=False), nullable=False),
            sa.Column("block_start", sa.DateTime(timezone=False), nullable=False),
            sa.Column("block_end", sa.DateTime(timezone=False), nullable=False),
            _str("status", 16, "confirmed"), _str("source", 8, "staff"),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("cancel_token", sa.String(64), nullable=False),
            sa.Column("consent_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("series_id", sa.Uuid(), nullable=True),
            sa.Column("invoice_id", sa.Uuid(), nullable=True),
            sa.Column("created_by", sa.String(64), nullable=True),
            sa.UniqueConstraint("cancel_token", name="uq_oe_appointments_booking_cancel_token"),
        )
        _index(t, "tenant_id", "service_id", "resource_id", "contact_id", "client_email", "start_at", "status",
               "series_id")

    t = "oe_appointments_reminder"
    if t not in existing:
        op.create_table(
            t, *_base(t),
            sa.Column("tenant_id", sa.String(36), nullable=False),
            sa.Column("booking_id", sa.Uuid(), sa.ForeignKey("oe_appointments_booking.id", ondelete="CASCADE"),
                      nullable=False),
            _str("channel", 8, "email"), _str("recipient", 255),
            sa.Column("due_at", sa.DateTime(timezone=False), nullable=False),
            _str("status", 8, "queued"), _str("detail", 255),
        )
        _index(t, "tenant_id", "booking_id", "due_at")


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in _TABLES:
        if table in existing:
            op.drop_table(table)
