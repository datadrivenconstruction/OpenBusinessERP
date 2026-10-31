# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Boot-path data repairs owned by the GL module.

``load_template`` runs once, when a company picks its chart. Accounts added to a
template afterwards (FX gains/losses, newer expense accounts) never reach that
ledger, and posting an FX difference then fails for want of its account.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final

from app.core.data_repairs import DataRepair, NeverDelivered, register_data_repair

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

REPAIR_ID: Final = "gl_template_accounts_reconcile"


async def reconcile_template_accounts(session: AsyncSession) -> int:
    """Add template accounts a seeded ledger lacks; each (tenant, code) is delivered at most once.

    Codes already on file are recorded as delivered too, so an account the
    customer later deletes is not brought back on the next boot.
    """
    from sqlalchemy import select

    from app.core.data_repairs import delivered_keys, record_deliveries
    from app.modules.gl.models import GLAccount
    from app.modules.gl.templates import TEMPLATES

    pairs = (
        await session.execute(
            select(GLAccount.tenant_id, GLAccount.template).where(GLAccount.template.in_(list(TEMPLATES))).distinct()
        )
    ).all()
    if not pairs:
        return 0
    done = await delivered_keys(session, REPAIR_ID)
    created = 0
    for tenant_id, key in pairs:
        accounts = {
            a.code: a
            for a in (await session.execute(select(GLAccount).where(GLAccount.tenant_id == tenant_id))).scalars()
        }
        new_keys: list[str] = []
        for code, name, typ, parent_code, postable in TEMPLATES[key]:
            dkey = f"{tenant_id}/{code}"
            if dkey in done:
                continue
            new_keys.append(dkey)
            if code in accounts:
                continue
            parent = accounts.get(parent_code) if parent_code else None
            acc = GLAccount(
                code=code,
                name=name,
                account_type=typ,
                parent_id=parent.id if parent else None,
                is_postable=postable,
                active=True,
                template=key,
                tenant_id=tenant_id,
            )
            session.add(acc)
            await session.flush()
            accounts[code] = acc
            created += 1
        if new_keys:
            await record_deliveries(session, REPAIR_ID, new_keys)
    return created


GL_TEMPLATE_ACCOUNTS_RECONCILE = register_data_repair(
    DataRepair(
        repair_id="gl_template_accounts_reconcile",
        revision="",
        summary="Add chart-template accounts (FX gains/losses and later additions) a seeded ledger lacks",
        run=reconcile_template_accounts,
        nature="never_delivered",
        never_delivered=NeverDelivered(table="oe_gl_account", identified_by=("tenant_id", "code")),
    )
)
