"""Item master tables: categories, items, price lists with quantity breaks, discount rules.

Fresh installs get these from the model declarations; tables that already exist are left alone.

Revision ID: v62_items_master
Revises: v61_finance_tenant
"""

import sqlalchemy as sa
from alembic import op

revision = "v62_items_master"
down_revision = "v61_finance_tenant"
branch_labels = None
depends_on = None

_TABLES = (
    "oe_items_discount_rule",
    "oe_items_price_list_item",
    "oe_items_price_list",
    "oe_items_item",
    "oe_items_category",
)


def _base(table: str) -> list:
    return [
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
    ]


def _tenant() -> sa.Column:
    return sa.Column("tenant_id", sa.String(36), nullable=True)


def _validity() -> list:
    return [sa.Column("valid_from", sa.Date(), nullable=True), sa.Column("valid_to", sa.Date(), nullable=True)]


def _flag(name: str, default: bool) -> sa.Column:
    return sa.Column(name, sa.Boolean(), nullable=False, server_default=sa.true() if default else sa.false())


def _index(table: str, *cols: str) -> None:
    for col in cols:
        op.create_index(f"ix_{table}_{col}", table, [col])


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    if "oe_items_category" not in existing:
        op.create_table(
            "oe_items_category",
            *_base("oe_items_category"),
            _tenant(),
            sa.Column("name", sa.String(128), nullable=False),
            sa.Column("parent_id", sa.Uuid(), sa.ForeignKey("oe_items_category.id", ondelete="SET NULL"), nullable=True),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.UniqueConstraint("tenant_id", "name", name="uq_oe_items_category_tenant_name"),
        )
        _index("oe_items_category", "tenant_id")

    if "oe_items_item" not in existing:
        op.create_table(
            "oe_items_item",
            *_base("oe_items_item"),
            _tenant(),
            sa.Column("sku", sa.String(64), nullable=False),
            sa.Column("name", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False, server_default=""),
            sa.Column("item_type", sa.String(16), nullable=False, server_default="goods"),
            sa.Column("uom", sa.String(16), nullable=False, server_default="pcs"),
            sa.Column("sales_price", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("purchase_cost", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
            sa.Column("tax_code", sa.String(16), nullable=False, server_default=""),
            sa.Column("revenue_account", sa.String(32), nullable=False, server_default=""),
            sa.Column("expense_account", sa.String(32), nullable=False, server_default=""),
            _flag("stock_tracked", False),
            sa.Column("barcode", sa.String(64), nullable=False, server_default=""),
            sa.Column("category_id", sa.Uuid(), sa.ForeignKey("oe_items_category.id", ondelete="SET NULL"), nullable=True),
            _flag("active", True),
            sa.Column("created_by", sa.String(64), nullable=True),
            sa.UniqueConstraint("tenant_id", "sku", name="uq_oe_items_item_tenant_sku"),
        )
        _index("oe_items_item", "tenant_id", "sku", "name", "item_type", "barcode", "category_id", "active")

    if "oe_items_price_list" not in existing:
        op.create_table(
            "oe_items_price_list",
            *_base("oe_items_price_list"),
            _tenant(),
            sa.Column("name", sa.String(128), nullable=False),
            sa.Column("currency", sa.String(3), nullable=False, server_default="EUR"),
            sa.Column("customer_group", sa.String(64), nullable=False, server_default=""),
            sa.Column("customer_id", sa.Uuid(), nullable=True),
            *_validity(),
            sa.Column("priority", sa.Integer(), nullable=False, server_default="0"),
            _flag("active", True),
        )
        _index("oe_items_price_list", "tenant_id", "customer_id")

    if "oe_items_price_list_item" not in existing:
        op.create_table(
            "oe_items_price_list_item",
            *_base("oe_items_price_list_item"),
            sa.Column("price_list_id", sa.Uuid(), sa.ForeignKey("oe_items_price_list.id", ondelete="CASCADE"), nullable=False),
            sa.Column("item_id", sa.Uuid(), sa.ForeignKey("oe_items_item.id", ondelete="CASCADE"), nullable=False),
            sa.Column("min_qty", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("unit_price", sa.Numeric(18, 4), nullable=False),
            sa.UniqueConstraint("price_list_id", "item_id", "min_qty", name="uq_oe_items_price_list_item_break"),
        )
        _index("oe_items_price_list_item", "price_list_id", "item_id")

    if "oe_items_discount_rule" not in existing:
        op.create_table(
            "oe_items_discount_rule",
            *_base("oe_items_discount_rule"),
            _tenant(),
            sa.Column("name", sa.String(128), nullable=False),
            sa.Column("item_id", sa.Uuid(), sa.ForeignKey("oe_items_item.id", ondelete="CASCADE"), nullable=True),
            sa.Column("category_id", sa.Uuid(), sa.ForeignKey("oe_items_category.id", ondelete="CASCADE"), nullable=True),
            sa.Column("customer_group", sa.String(64), nullable=False, server_default=""),
            sa.Column("customer_id", sa.Uuid(), nullable=True),
            sa.Column("min_qty", sa.Numeric(18, 4), nullable=False, server_default="0"),
            sa.Column("discount_pct", sa.Numeric(7, 4), nullable=False),
            *_validity(),
            _flag("active", True),
        )
        _index("oe_items_discount_rule", "tenant_id", "item_id")


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in _TABLES:
        if table in existing:
            op.drop_table(table)
