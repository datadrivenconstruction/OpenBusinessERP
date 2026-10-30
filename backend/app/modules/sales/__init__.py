"""Sales: order-to-cash (quote -> sales order -> invoice -> payment).

Issued invoices and payments post balanced journal entries through the GL
service; the project-bound ``finance`` invoices are left untouched.
"""


async def on_startup() -> None:
    from app.modules.sales.permissions import register_sales_permissions

    register_sales_permissions()
