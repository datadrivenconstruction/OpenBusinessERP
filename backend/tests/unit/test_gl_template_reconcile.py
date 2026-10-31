"""Boot repair: a ledger seeded before template accounts were added gets them once."""

from __future__ import annotations

from sqlalchemy import delete, select

from app.modules.gl.models import GLAccount
from app.modules.gl.repairs import reconcile_template_accounts
from app.modules.gl.service import GLService
from tests._pg import transactional_session

T1 = "tenant-gl-reconcile"


async def _codes(s) -> set[str]:
    return set((await s.execute(select(GLAccount.code).where(GLAccount.tenant_id == T1))).scalars())


async def test_missing_fx_accounts_are_added_once_and_deletions_stick():
    async with transactional_session() as s:
        await GLService(s, T1).load_template("de_skr03")
        await s.execute(delete(GLAccount).where(GLAccount.tenant_id == T1, GLAccount.code.in_(["2660", "2150"])))
        assert await reconcile_template_accounts(s) == 2
        assert {"2660", "2150"} <= await _codes(s)
        assert await reconcile_template_accounts(s) == 0

        await s.execute(delete(GLAccount).where(GLAccount.tenant_id == T1, GLAccount.code == "2660"))
        assert await reconcile_template_accounts(s) == 0
        assert "2660" not in await _codes(s)
