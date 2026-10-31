"""Inventory: warehouses, stock movements, moving-average cost, stocktakes.

On-hand quantity is never stored per warehouse: it is the signed sum of movements.
"""


async def on_startup() -> None:
    from app.modules.inventory.permissions import register_inventory_permissions

    register_inventory_permissions()
