"""Receivables permission definitions."""

from app.core.permissions import Role, permission_registry


def register_receivables_permissions() -> None:
    permission_registry.register_module_permissions(
        "receivables",
        {
            "receivables.read": Role.VIEWER,
            "receivables.write": Role.EDITOR,
            "receivables.manage": Role.MANAGER,
        },
    )
