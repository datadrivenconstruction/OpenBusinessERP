"""Banking module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_banking",
    version="0.1.0",
    display_name="Banking",
    description="Bank accounts, statement import (camt.053/054, MT940, CSV) and payment reconciliation",
    author="OpenBusinessERP Core Team",
    category="core",
    depends=["oe_gl", "oe_sales"],
    auto_install=True,
    enabled=True,
)
