"""Data import wizard: CSV/XLSX upload, column mapping, validation, dry run, commit and undo.

Reads only files the user exported themselves; column presets are generic conventions
defined here. Rows are tenant-scoped via ``tenant_id``.
"""


async def on_startup() -> None:
    from app.modules.data_import.permissions import register_data_import_permissions

    register_data_import_permissions()
