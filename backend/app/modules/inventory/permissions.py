"""Inventory permission definitions."""

from app.core.permissions import Role, permission_registry


def register_inventory_permissions() -> None:
    permission_registry.register_module_permissions(
        "inventory",
        {
            "inventory.read": Role.VIEWER,
            "inventory.write": Role.EDITOR,
            # Stocktake posting and settings move GL balances.
            "inventory.manage": Role.MANAGER,
        },
    )
