"""Purchasing permission definitions."""

from app.core.permissions import Role, permission_registry


def register_purchasing_permissions() -> None:
    permission_registry.register_module_permissions(
        "purchasing",
        {
            "purchasing.read": Role.VIEWER,
            "purchasing.write": Role.EDITOR,
            # Receipts, bills and payments post to the GL.
            "purchasing.post": Role.MANAGER,
            "purchasing.manage": Role.MANAGER,
        },
    )
