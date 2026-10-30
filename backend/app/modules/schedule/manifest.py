# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""4D Schedule module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_schedule",
    version="0.1.0",
    display_name="4D Schedule",
    description="4D construction scheduling - linking BOQ positions to a timeline",
    author="OpenBusinessERP Core Team",
    category="core",
    depends=["oe_projects"],
    optional_depends=["oe_boq", "oe_assemblies"],
    auto_install=True,
    enabled=True,
)
