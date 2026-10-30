"""Sales module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_sales",
    version="0.1.0",
    display_name="Sales",
    description="Order-to-cash: quotes, sales orders, customer invoices and payments posted to the GL",
    author="OpenBusinessERP Core Team",
    category="core",
    depends=["oe_gl"],
    auto_install=True,
    enabled=True,
)
