"""Items module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_items",
    version="0.1.0",
    display_name="Products & services",
    description="Item master: goods, services and consumables with categories, price lists and discounts",
    author="OpenBusinessERP Core Team",
    category="core",
    depends=[],
    auto_install=True,
    enabled=True,
)
