"""Sales permission definitions."""

from app.core.permissions import Role, permission_registry


def register_sales_permissions() -> None:
    permission_registry.register_module_permissions(
        "sales",
        {
            "sales.read": Role.VIEWER,
            "sales.write": Role.EDITOR,
            # Issuing invoices and recording payments posts to the GL.
            "sales.post": Role.MANAGER,
            "sales.manage": Role.MANAGER,
        },
    )
