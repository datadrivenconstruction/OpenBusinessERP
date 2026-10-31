# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""Currency / FX module.

A construction project is estimated in one currency, procured in another and
reported in a third, and all three move for the whole of a multi-year
programme. This module is the register that keeps that traceable: published
rate sets with their provenance, point-in-time lookup, per-project currency
policy with optional pinning, and revaluation that separates what moved because
the scope moved from what moved because the rate did.

Market rates come from the European Central Bank daily reference feed (EUR
based). Resolution falls back from the applicable rate set to the legacy
latest-rate cache and finally to a small bundled seed of major currencies, so
conversion degrades gracefully with no hard network dependency, and every
answer says which of the three it used. Optional purchasing-power-parity
conversion uses World Bank factors and reports "unavailable" rather than
failing when a factor is missing.
"""


async def on_startup() -> None:
    """Module startup hook - register RBAC permissions and validation rules."""
    from app.modules.fx.permissions import register_fx_permissions
    from app.modules.fx.validators import register_fx_rules

    register_fx_permissions()
    register_fx_rules()
    _start_daily_import()


_DAILY_TASK = None


def _daily_enabled() -> bool:
    import os

    from app.core.business_settings import read_business_settings

    if os.environ.get("OE_FX_DAILY_IMPORT") == "1":
        return True
    try:
        return bool(read_business_settings().get("fx_daily_import"))
    except Exception:  # noqa: BLE001 - settings unreadable means off
        return False


def _start_daily_import() -> None:
    """Opt-in daily ECB import; offline it logs and keeps cache/seed rates, never fails startup."""
    global _DAILY_TASK
    if _DAILY_TASK is not None or not _daily_enabled():
        return
    import asyncio
    import logging

    log = logging.getLogger(__name__)

    async def loop() -> None:
        from app.database import async_session_factory
        from app.modules.fx.service import FxService

        await asyncio.sleep(60)
        while True:
            try:
                async with async_session_factory() as session:
                    res = await FxService(session).refresh()
                    await session.commit()
                log.info("FX daily import: %s", res.get("note"))
            except Exception:  # noqa: BLE001 - background job must survive anything
                log.warning("FX daily import failed", exc_info=True)
            await asyncio.sleep(24 * 3600)

    try:
        _DAILY_TASK = asyncio.get_running_loop().create_task(loop(), name="fx-daily-import")
    except RuntimeError:
        log.debug("No running loop; FX daily import not scheduled")
