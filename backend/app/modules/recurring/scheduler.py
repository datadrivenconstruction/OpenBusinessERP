"""Background loop that bills due recurring invoices (same asyncio-loop pattern as the other sweepers)."""

from __future__ import annotations

import asyncio
import logging
import os
from datetime import date

logger = logging.getLogger(__name__)

INTERVAL_SECONDS = 3600
FIRST_TICK_DELAY_SECONDS = 120
_TASK: asyncio.Task[None] | None = None


async def tick(today: date | None = None) -> int:
    """One sweep over all tenants; each tenant commits on its own so one failure does not block the rest."""
    from app.database import async_session_factory
    from app.modules.recurring.service import RecurringService, due_tenants

    today = today or date.today()
    async with async_session_factory() as session:
        tenants = await due_tenants(session, today)
    made = 0
    for tenant in tenants:
        try:
            async with async_session_factory() as session:
                results = await RecurringService(session, tenant).run_due(today)
                await session.commit()
                made += sum(1 for r in results if r.document_id and r.status != "skipped")
        except Exception:
            logger.exception("Recurring invoice run failed for tenant %s", tenant)
    if made:
        logger.info("Recurring invoices: %d generated", made)
    return made


async def _loop() -> None:
    await asyncio.sleep(FIRST_TICK_DELAY_SECONDS)
    while True:
        try:
            await tick()
        except Exception:
            logger.exception("Recurring invoice scheduler tick failed")
        await asyncio.sleep(INTERVAL_SECONDS)


def start_scheduler() -> asyncio.Task[None] | None:
    """Idempotent: a live task is kept. Off under fast test startup or OE_RECURRING_SCHEDULER=0."""
    global _TASK
    if os.environ.get("OE_TEST_FAST_STARTUP", "").lower() in ("1", "true", "yes"):
        return None
    if os.environ.get("OE_RECURRING_SCHEDULER", "1").lower() in ("0", "false", "no"):
        return None
    if _TASK is not None and not _TASK.done():
        return _TASK
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return None
    _TASK = loop.create_task(_loop(), name="recurring-invoices")
    return _TASK
