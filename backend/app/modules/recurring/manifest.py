"""Recurring invoices module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_recurring",
    version="0.1.0",
    display_name="Recurring invoices",
    description="Subscription and contract templates that generate sales invoices on a schedule",
    author="OpenBusinessERP Core Team",
    category="core",
    depends=["oe_sales"],
    auto_install=True,
    enabled=True,
)
