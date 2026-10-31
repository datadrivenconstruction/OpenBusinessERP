"""Inventory module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_inventory",
    version="0.1.0",
    display_name="Inventory",
    description="Warehouses, stock movement ledger, moving-average valuation, transfers and stocktakes",
    author="OpenBusinessERP Core Team",
    category="core",
    depends=["oe_items"],
    auto_install=True,
    enabled=True,
)
