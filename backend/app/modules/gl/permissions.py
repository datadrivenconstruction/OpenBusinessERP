# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""General Ledger permission definitions."""

from app.core.permissions import Role, permission_registry


def register_gl_permissions() -> None:
    """Register permissions for the GL module."""
    permission_registry.register_module_permissions(
        "gl",
        {
            # Read accounts, entries and reports.
            "gl.read": Role.VIEWER,
            # Create, edit and delete draft entries.
            "gl.write": Role.EDITOR,
            # Post and reverse entries: the act that makes figures final.
            "gl.post": Role.MANAGER,
            # Chart of accounts, fiscal years, period close.
            "gl.manage": Role.MANAGER,
        },
    )
