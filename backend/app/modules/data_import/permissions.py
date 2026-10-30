"""Data import permission definitions."""

from app.core.permissions import Role, permission_registry


def register_data_import_permissions() -> None:
    permission_registry.register_module_permissions(
        "data_import",
        {
            "data_import.read": Role.VIEWER,
            # Imports write master data and ledger entries in bulk.
            "data_import.write": Role.MANAGER,
        },
    )
