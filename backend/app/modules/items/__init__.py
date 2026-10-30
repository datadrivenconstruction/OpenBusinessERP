"""Items: product/service master, categories, price lists and discount rules.

Rows are tenant-scoped via ``tenant_id`` (see app.core.tenant_scope).
"""


async def on_startup() -> None:
    from app.modules.items.permissions import register_items_permissions

    register_items_permissions()
