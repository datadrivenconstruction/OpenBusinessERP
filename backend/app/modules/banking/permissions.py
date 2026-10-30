"""Banking permission definitions."""

from app.core.permissions import Role, permission_registry


def register_banking_permissions() -> None:
    permission_registry.register_module_permissions(
        "banking",
        {
            "banking.read": Role.VIEWER,
            "banking.import": Role.EDITOR,
            # Confirming matches and manual entries post to the GL.
            "banking.post": Role.MANAGER,
            "banking.manage": Role.MANAGER,
        },
    )
