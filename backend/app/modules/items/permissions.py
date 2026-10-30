"""Items permission definitions."""

from app.core.permissions import Role, permission_registry


def register_items_permissions() -> None:
    permission_registry.register_module_permissions(
        "items",
        {
            "items.read": Role.VIEWER,
            "items.write": Role.EDITOR,
            # Price lists and discount rules change what customers are charged.
            "items.manage": Role.MANAGER,
        },
    )
