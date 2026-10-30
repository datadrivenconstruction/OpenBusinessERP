"""Purchasing module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_purchasing",
    version="0.1.0",
    display_name="Purchasing",
    description="Purchase-to-pay: purchase orders, goods receipts, supplier bills with 3-way match, payments",
    author="OpenBusinessERP Core Team",
    category="core",
    depends=["oe_gl"],
    auto_install=True,
    enabled=True,
)
