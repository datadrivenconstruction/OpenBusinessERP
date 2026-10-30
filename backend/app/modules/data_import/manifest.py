"""Data import module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_data_import",
    version="0.1.0",
    display_name="Data import",
    description="Import customers, suppliers, items, opening balances and open invoices from CSV/XLSX",
    author="OpenBusinessERP Core Team",
    category="core",
    depends=["oe_gl", "oe_items", "oe_sales", "oe_contacts"],
    auto_install=True,
    enabled=True,
)
