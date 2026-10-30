"""Purchasing: business purchase-to-pay (PO -> goods receipt -> supplier bill -> payment).

Company-level counterpart of the project-bound ``procurement`` module; receipts, bills,
credit notes and payments post balanced journal entries through the GL service.
"""


async def on_startup() -> None:
    from app.modules.purchasing.permissions import register_purchasing_permissions

    register_purchasing_permissions()
