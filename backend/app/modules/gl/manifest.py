# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""General Ledger module manifest."""

from app.core.module_loader import ModuleManifest

manifest = ModuleManifest(
    name="oe_gl",
    version="0.1.0",
    display_name="General Ledger",
    description=(
        "Double-entry accounting core: chart of accounts (IFRS, DE SKR03 templates), fiscal years "
        "and periods, immutable posted journal entries with reversal, trial balance and statements"
    ),
    author="OpenBusinessERP Core Team",
    category="core",
    depends=[],
    auto_install=True,
    enabled=True,
)
