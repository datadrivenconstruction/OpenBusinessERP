"""Inventory: warehouses, stock movement ledger, moving-average cost, stocktakes, settings.

Fresh installs get these from the model declarations; tables that already exist are left alone.

Revision ID: v74_stock_inventory
Revises: v73_recurring_invoices
"""

import uuid
from datetime import date
from decimal import Decimal

import sqlalchemy as sa
from alembic import op

revision = "v74_stock_inventory"
down_revision = "v73_recurring_invoices"
branch_labels = None
depends_on = None

_TABLES = (
    "oe_inventory_stocktake_line",
    "oe_inventory_stocktake",
    "oe_inventory_movement",
    "oe_inventory_item_cost",
    "oe_inventory_settings",
    "oe_inventory_warehouse",
)
QTY = sa.Numeric(18, 4)
COST = sa.Numeric(18, 6)
MONEY = sa.Numeric(18, 2)


def _base(table: str) -> list:
    return [
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
    ]


def _tenant() -> sa.Column:
    return sa.Column("tenant_id", sa.String(36), nullable=False)


def _flag(name: str, default: bool) -> sa.Column:
    return sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.true() if default else sa.false())


def _text(name: str, length: int | None = None) -> sa.Column:
    return sa.Column(name, sa.String(length) if length else sa.Text(), nullable=False, server_default="")


def _index(table: str, *cols: str) -> None:
    for col in cols:
        op.create_index(f"ix_{table}_{col}", table, [col])


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "oe_inventory_warehouse" not in existing:
        op.create_table(
            "oe_inventory_warehouse",
            *_base("oe_inventory_warehouse"),
            _tenant(),
            sa.Column("code", sa.String(32), nullable=False),
            sa.Column("name", sa.String(128), nullable=False),
            _text("address"),
            _flag("is_default", False),
            _flag("active", True),
            sa.UniqueConstraint("tenant_id", "code", name="uq_oe_inventory_warehouse_tenant_code"),
        )
        _index("oe_inventory_warehouse", "tenant_id")

    if "oe_inventory_movement" not in existing:
        op.create_table(
            "oe_inventory_movement",
            *_base("oe_inventory_movement"),
            _tenant(),
            sa.Column("item_id", sa.String(36), nullable=False),
            sa.Column(
                "warehouse_id",
                sa.String(36),
                sa.ForeignKey("oe_inventory_warehouse.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("kind", sa.String(16), nullable=False),
            sa.Column("move_date", sa.Date(), nullable=False),
            sa.Column("qty", QTY, nullable=False),
            sa.Column("unit_cost", COST, nullable=False, server_default="0"),
            sa.Column("value", MONEY, nullable=False, server_default="0"),
            _text("source_type", 32),
            _text("source_id", 64),
            _text("source_number", 64),
            sa.Column("reversal_of_id", sa.String(36), nullable=True),
            _flag("reversed", False),
            sa.Column("transfer_group", sa.String(36), nullable=True),
            sa.Column("gl_entry_id", sa.String(36), nullable=True),
            _text("notes"),
            sa.Column("created_by", sa.String(64), nullable=True),
        )
        _index(
            "oe_inventory_movement",
            "tenant_id",
            "item_id",
            "warehouse_id",
            "kind",
            "move_date",
            "source_type",
            "source_id",
        )

    if "oe_inventory_item_cost" not in existing:
        op.create_table(
            "oe_inventory_item_cost",
            *_base("oe_inventory_item_cost"),
            _tenant(),
            sa.Column("item_id", sa.String(36), nullable=False),
            sa.Column("qty", QTY, nullable=False, server_default="0"),
            sa.Column("value", MONEY, nullable=False, server_default="0"),
            sa.Column("avg_cost", COST, nullable=False, server_default="0"),
            sa.UniqueConstraint("tenant_id", "item_id", name="uq_oe_inventory_item_cost_tenant_item"),
        )
        _index("oe_inventory_item_cost", "tenant_id")

    if "oe_inventory_stocktake" not in existing:
        op.create_table(
            "oe_inventory_stocktake",
            *_base("oe_inventory_stocktake"),
            _tenant(),
            sa.Column("number", sa.String(32), nullable=False),
            sa.Column(
                "warehouse_id",
                sa.String(36),
                sa.ForeignKey("oe_inventory_warehouse.id", ondelete="RESTRICT"),
                nullable=False,
            ),
            sa.Column("status", sa.String(16), nullable=False, server_default="draft"),
            sa.Column("count_date", sa.Date(), nullable=False),
            _text("notes"),
            sa.Column("diff_value", MONEY, nullable=False, server_default="0"),
            sa.Column("gl_entry_id", sa.String(36), nullable=True),
            sa.Column("created_by", sa.String(64), nullable=True),
        )
        _index("oe_inventory_stocktake", "tenant_id", "number", "warehouse_id", "status")

    if "oe_inventory_stocktake_line" not in existing:
        op.create_table(
            "oe_inventory_stocktake_line",
            *_base("oe_inventory_stocktake_line"),
            sa.Column(
                "stocktake_id",
                sa.String(36),
                sa.ForeignKey("oe_inventory_stocktake.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("line_no", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("item_id", sa.String(36), nullable=False),
            _text("sku", 64),
            _text("name", 255),
            _text("uom", 16),
            sa.Column("expected_qty", QTY, nullable=False, server_default="0"),
            sa.Column("counted_qty", QTY, nullable=True),
            sa.Column("unit_cost", COST, nullable=False, server_default="0"),
            sa.Column("diff_qty", QTY, nullable=False, server_default="0"),
            sa.Column("diff_value", MONEY, nullable=False, server_default="0"),
        )
        _index("oe_inventory_stocktake_line", "stocktake_id")

    if "oe_inventory_settings" not in existing:
        op.create_table(
            "oe_inventory_settings",
            *_base("oe_inventory_settings"),
            _tenant(),
            _flag("allow_negative", False),
            _text("inventory_account", 32),
            _text("cogs_account", 32),
            _text("diff_account", 32),
            sa.UniqueConstraint("tenant_id", name="uq_oe_inventory_settings_tenant"),
        )
        _index("oe_inventory_settings", "tenant_id")

    if "oe_purchasing_stock" in existing:
        _backfill_from_purchasing_stock()


def _backfill_from_purchasing_stock() -> None:
    """Carry purchasing on-hand into the ledger as opening movements (tenants without movements only)."""
    bind = op.get_bind()
    rows = bind.execute(
        sa.text("SELECT tenant_id, item_id, qty, value FROM oe_purchasing_stock WHERE qty <> 0 ORDER BY tenant_id")
    ).fetchall()
    seen: set[str] = set()
    skip: set[str] = set()
    today = date.today()
    for tenant, item_id, qty, value in rows:
        if tenant not in seen:
            seen.add(tenant)
            if bind.execute(
                sa.text("SELECT 1 FROM oe_inventory_movement WHERE tenant_id = :t LIMIT 1"), {"t": tenant}
            ).first():
                skip.add(tenant)
            elif not bind.execute(
                sa.text("SELECT 1 FROM oe_inventory_warehouse WHERE tenant_id = :t LIMIT 1"), {"t": tenant}
            ).first():
                bind.execute(
                    sa.text(
                        "INSERT INTO oe_inventory_warehouse (id, tenant_id, code, name, address, is_default, active) "
                        "VALUES (:id, :t, 'MAIN', 'Main warehouse', '', true, true)"
                    ),
                    {"id": str(uuid.uuid4()), "t": tenant},
                )
        if tenant in skip:
            continue
        wh = bind.execute(
            sa.text(
                "SELECT id FROM oe_inventory_warehouse WHERE tenant_id = :t ORDER BY is_default DESC, created_at LIMIT 1"
            ),
            {"t": tenant},
        ).scalar()
        qty, value = Decimal(qty), Decimal(value)
        avg = (value / qty).quantize(Decimal("0.000001")) if qty > 0 else Decimal(0)
        bind.execute(
            sa.text(
                "INSERT INTO oe_inventory_movement (id, tenant_id, item_id, warehouse_id, kind, move_date, qty, "
                "unit_cost, value, source_type, source_id, source_number, reversed, notes) VALUES "
                "(:id, :t, :i, :w, 'opening', :d, :q, :c, :v, 'inventory_opening', '', '', false, "
                "'Opening balance from purchasing stock')"
            ),
            {"id": str(uuid.uuid4()), "t": tenant, "i": item_id, "w": wh, "d": today, "q": qty, "c": avg, "v": value},
        )
        bind.execute(
            sa.text(
                "INSERT INTO oe_inventory_item_cost (id, tenant_id, item_id, qty, value, avg_cost) "
                "VALUES (:id, :t, :i, :q, :v, :c) ON CONFLICT DO NOTHING"
            ),
            {"id": str(uuid.uuid4()), "t": tenant, "i": item_id, "q": qty, "v": value, "c": avg},
        )


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in _TABLES:
        if table in existing:
            op.drop_table(table)
