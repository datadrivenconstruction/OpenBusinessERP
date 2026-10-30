"""Banking: bank accounts, statement import (camt.053/054, MT940, CSV), matching and reconciliation.

Confirmed matches post customer receipts and supplier payments through the
sales and purchasing services; leftover lines can be booked to any GL account.
"""


async def on_startup() -> None:
    from app.modules.banking.permissions import register_banking_permissions

    register_banking_permissions()
