# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""General Ledger: the double-entry accounting core.

Posted entries are immutable and balanced in base currency; corrections are
made by reversal, never by edit. Numbering is gap-free per fiscal year and is
assigned at posting time.
"""


async def on_startup() -> None:
    """Module startup hook - register RBAC permissions."""
    from app.modules.gl.permissions import register_gl_permissions

    register_gl_permissions()
