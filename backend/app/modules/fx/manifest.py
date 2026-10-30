# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Currency / FX module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_fx",
    version="1.0.0",
    display_name="Currency / FX",
    description=(
        "Exchange-rate register: published rate sets with provenance, point-in-time conversion, "
        "per-project currency policy with pinning, and revaluation that separates scope movement "
        "from rate movement"
    ),
    author="OpenBusinessERP Core Team",
    category="core",
    depends=[],
    auto_install=True,
    enabled=True,
)
