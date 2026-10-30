"""Purchasing (purchase-to-pay): orders, receipts, supplier bills, payments, stock on hand.

Fresh installs get these from the model declarations; tables that already exist are left alone.

Revision ID: v63_purchasing_core
Revises: v62_items_master
"""

import sqlalchemy as sa
from alembic import op

revision = "v63_purchasing_core"
down_revision = "v62_items_master"
branch_labels = None
depends_on = None

_TABLES = (
    "oe_purchasing_payment",
    "oe_purchasing_bill_line",
    "oe_purchasing_bill",
    "oe_purchasing_receipt_line",
    "oe_purchasing_receipt",
    "oe_purchasing_order_line",
    "oe_purchasing_order",
    "oe_purchasing_stock",
    "oe_purchasing_sequence",
    "oe_purchasing_account_map",
)


def _base(table: str) -> list:
    return [
        sa.Column("id", sa.String(36), nullable=False),
        sa.Column(
            "created_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column(
            "updated_at", sa.DateTime(timezone=True), server_default=sa.text("CURRENT_TIMESTAMP"), nullable=False
        ),
        sa.Column("tenant_id", sa.String(36), nullable=False, server_default="default"),
        sa.PrimaryKeyConstraint("id", name=f"pk_{table}"),
    ]


def _money(name: str) -> sa.Column:
    return sa.Column(name, sa.Numeric(18, 2), nullable=False, server_default="0")


def _num(name: str, default: str = "0") -> sa.Column:
    return sa.Column(name, sa.Numeric(18, 4), nullable=False, server_default=default)


def _str(name: str, length: int, default: str = "") -> sa.Column:
    return sa.Column(name, sa.String(length), nullable=False, server_default=default)


def _fk(name: str, target: str, ondelete: str, nullable: bool) -> sa.Column:
    return sa.Column(name, sa.String(36), sa.ForeignKey(f"{target}.id", ondelete=ondelete), nullable=nullable)


def _header() -> list:
    return [
        _str("number", 32),
        _str("status", 24, "draft"),
        sa.Column("supplier_id", sa.String(36), nullable=True),
        _str("supplier_name", 255),
        _str("currency", 3, "EUR"),
        sa.Column("fx_rate", sa.Numeric(20, 10), nullable=False, server_default="1"),
        sa.Column("doc_date", sa.Date(), nullable=False),
        sa.Column("due_date", sa.Date(), nullable=True),
        _money("net_total"),
        _money("tax_total"),
        _money("gross_total"),
        sa.Column("notes", sa.Text(), nullable=False, server_default=""),
        sa.Column("created_by", sa.String(64), nullable=True),
    ]


def _line() -> list:
    return [
        sa.Column("line_no", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("item_id", sa.String(36), nullable=True),
        _str("sku", 64),
        _str("description", 500),
        _num("qty", "1"),
        _num("unit_price"),
        sa.Column("tax_rate", sa.Numeric(7, 4), nullable=False, server_default="0"),
        _money("net"),
        _money("tax"),
        _money("gross"),
    ]


def _index(table: str, *cols: str) -> None:
    for col in cols:
        op.create_index(f"ix_{table}_{col}", table, [col])


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())

    t = "oe_purchasing_order"
    if t not in existing:
        op.create_table(
            t,
            *_base(t),
            *_header(),
            sa.UniqueConstraint("tenant_id", "number", name="uq_oe_purchasing_order_tenant_number"),
        )
        _index(t, "tenant_id", "number", "status", "supplier_id")

    t = "oe_purchasing_order_line"
    if t not in existing:
        op.create_table(
            t,
            *_base(t),
            _fk("order_id", "oe_purchasing_order", "CASCADE", False),
            *_line(),
            _num("qty_received"),
            _num("qty_billed"),
        )
        _index(t, "tenant_id", "order_id", "item_id")

    t = "oe_purchasing_receipt"
    if t not in existing:
        op.create_table(
            t,
            *_base(t),
            _str("number", 32),
            _str("status", 24, "posted"),
            _fk("order_id", "oe_purchasing_order", "CASCADE", False),
            _str("order_number", 32),
            _str("supplier_name", 255),
            _str("currency", 3, "EUR"),
            sa.Column("fx_rate", sa.Numeric(20, 10), nullable=False, server_default="1"),
            sa.Column("doc_date", sa.Date(), nullable=False),
            _money("value_total"),
            sa.Column("gl_entry_id", sa.String(36), nullable=True),
            sa.Column("notes", sa.Text(), nullable=False, server_default=""),
            sa.Column("created_by", sa.String(64), nullable=True),
            sa.UniqueConstraint("tenant_id", "number", name="uq_oe_purchasing_receipt_tenant_number"),
        )
        _index(t, "tenant_id", "number", "status", "order_id")

    t = "oe_purchasing_receipt_line"
    if t not in existing:
        op.create_table(
            t,
            *_base(t),
            _fk("receipt_id", "oe_purchasing_receipt", "CASCADE", False),
            _fk("order_line_id", "oe_purchasing_order_line", "CASCADE", False),
            sa.Column("line_no", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("item_id", sa.String(36), nullable=True),
            _str("sku", 64),
            _str("description", 500),
            sa.Column("qty", sa.Numeric(18, 4), nullable=False),
            _num("unit_cost"),
            _money("value"),
            sa.Column("stock_tracked", sa.Boolean(), nullable=False, server_default=sa.false()),
        )
        _index(t, "tenant_id", "receipt_id", "order_line_id")

    t = "oe_purchasing_bill"
    if t not in existing:
        op.create_table(
            t,
            *_base(t),
            *_header(),
            _str("kind", 16, "bill"),
            _str("supplier_ref", 64),
            _fk("order_id", "oe_purchasing_order", "SET NULL", True),
            _fk("receipt_id", "oe_purchasing_receipt", "SET NULL", True),
            _fk("source_id", "oe_purchasing_bill", "SET NULL", True),
            _money("amount_paid"),
            _str("match_status", 24, "none"),
            sa.Column("gl_entry_id", sa.String(36), nullable=True),
            sa.UniqueConstraint("tenant_id", "kind", "number", name="uq_oe_purchasing_bill_tenant_kind_number"),
        )
        _index(
            t,
            "tenant_id",
            "kind",
            "number",
            "status",
            "supplier_id",
            "order_id",
            "receipt_id",
            "source_id",
            "match_status",
        )

    t = "oe_purchasing_bill_line"
    if t not in existing:
        op.create_table(
            t,
            *_base(t),
            _fk("bill_id", "oe_purchasing_bill", "CASCADE", False),
            _fk("order_line_id", "oe_purchasing_order_line", "SET NULL", True),
            *_line(),
            _str("match_status", 24, "none"),
        )
        _index(t, "tenant_id", "bill_id", "order_line_id")

    t = "oe_purchasing_payment"
    if t not in existing:
        op.create_table(
            t,
            *_base(t),
            _fk("bill_id", "oe_purchasing_bill", "CASCADE", False),
            sa.Column("pay_date", sa.Date(), nullable=False),
            sa.Column("amount", sa.Numeric(18, 2), nullable=False),
            _str("method", 32, "bank_transfer"),
            _str("reference", 128),
            sa.Column("gl_entry_id", sa.String(36), nullable=True),
        )
        _index(t, "tenant_id", "bill_id")

    t = "oe_purchasing_stock"
    if t not in existing:
        op.create_table(
            t,
            *_base(t),
            sa.Column("item_id", sa.String(36), nullable=False),
            _str("sku", 64),
            _num("qty"),
            _money("value"),
            sa.UniqueConstraint("tenant_id", "item_id", name="uq_oe_purchasing_stock_tenant_item"),
        )
        _index(t, "tenant_id", "item_id")

    t = "oe_purchasing_sequence"
    if t not in existing:
        op.create_table(
            t,
            *_base(t),
            _str("kind", 16),
            sa.Column("last_number", sa.Integer(), nullable=False, server_default="0"),
            sa.UniqueConstraint("tenant_id", "kind", name="uq_oe_purchasing_sequence_tenant_kind"),
        )
        _index(t, "tenant_id")

    t = "oe_purchasing_account_map"
    if t not in existing:
        op.create_table(
            t,
            *_base(t),
            _str("role", 32),
            _str("account_code", 32),
            sa.UniqueConstraint("tenant_id", "role", name="uq_oe_purchasing_account_map_tenant_role"),
        )
        _index(t, "tenant_id")


def downgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    for table in _TABLES:
        if table in existing:
            op.drop_table(table)
