"""Recurring invoices: templates that turn into ordinary sales invoices per period.

Permissions reuse ``sales.read`` / ``sales.manage``; generation goes through
``SalesService`` so numbering, totals and GL posting stay in one place.
"""


async def on_startup() -> None:
    from app.modules.recurring.scheduler import start_scheduler

    start_scheduler()
