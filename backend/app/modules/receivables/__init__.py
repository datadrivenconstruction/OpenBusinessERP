"""Receivables: aging, dunning (draft-only, never sent automatically), block list, statements."""


async def on_startup() -> None:
    from app.modules.receivables.permissions import register_receivables_permissions

    register_receivables_permissions()
