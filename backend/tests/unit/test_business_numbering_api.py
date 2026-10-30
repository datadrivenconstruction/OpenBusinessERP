"""GET /business-settings/numbering/ - tenant-scoped document numbering overview."""

from __future__ import annotations

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI

from app.core.business_settings_router import router
from app.dependencies import get_current_company_tenant_id, get_current_user_payload, get_session
from app.modules.sales.service import SalesService
from tests._pg import transactional_session

pytestmark = pytest.mark.asyncio
T1, T2 = "tenant-num-a", "tenant-num-b"


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


def _client(session, tenant):
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")

    async def _session():
        yield session

    async def _payload():
        return {"sub": "u1", "role": "admin"}

    async def _tenant():
        return tenant

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_current_user_payload] = _payload
    app.dependency_overrides[get_current_company_tenant_id] = _tenant
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t")


async def test_numbering_is_tenant_scoped(session):
    assert await SalesService(session, T1)._next_number("invoice") == "INV-000001"
    assert await SalesService(session, T1)._next_number("invoice") == "INV-000002"
    async with _client(session, T1) as c:
        rows = {(r["area"], r["kind"]): r for r in (await c.get("/api/v1/business-settings/numbering/")).json()}
    assert rows[("sales", "invoice")]["last_number"] == 2
    assert rows[("sales", "invoice")]["next_number"] == "INV-000003"
    assert rows[("purchasing", "bill")]["next_number"] == "BILL-000001"
    async with _client(session, T2) as c:
        rows = {(r["area"], r["kind"]): r for r in (await c.get("/api/v1/business-settings/numbering/")).json()}
    assert rows[("sales", "invoice")]["last_number"] == 0
