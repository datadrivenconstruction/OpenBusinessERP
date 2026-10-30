"""Receivables module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_receivables",
    version="0.1.0",
    display_name="Receivables",
    description="Receivables aging, dunning levels and draft dunning runs, customer statements",
    author="OpenBusinessERP Core Team",
    category="core",
    depends=["oe_sales", "oe_banking"],
    auto_install=True,
    enabled=True,
)
