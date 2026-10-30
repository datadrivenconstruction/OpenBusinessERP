# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Reporting module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_reporting",
    version="1.0.0",
    display_name="Reporting & Dashboards",
    description="KPI snapshots, report templates, and generated reports for projects and portfolios",
    author="OpenBusinessERP Core Team",
    category="core",
    depends=["oe_users", "oe_projects"],
    optional_depends=["oe_boq"],
    auto_install=True,
    enabled=True,
)
