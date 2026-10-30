"""Business demo cases API (mounted at /api/v1/business-demo).

    GET  /cases/                 -- Cases with an ``installed`` flag
    POST /cases/{key}/install/   -- Seed one case (idempotent, admin)
    POST /cases/{key}/reinstall/ -- Delete the case's demo rows for the tenant and seed it again (admin)
"""

from __future__ import annotations

import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app.core.business_demo import (
    CASES,
    BusinessDemoError,
    install_business_demo,
    installed_cases,
    list_cases,
    reinstall_business_demo,
)
from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequireRole, SessionDep, get_current_user_payload
from app.modules.gl.models import DEFAULT_TENANT

router = APIRouter(prefix="/business-demo", tags=["Business demo"])


@router.get("/cases/", dependencies=[Depends(get_current_user_payload)])
async def get_cases(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> list[dict[str, Any]]:
    done = set(await installed_cases(session, tenant_id or DEFAULT_TENANT))
    return [{**c, "installed": c["key"] in done} for c in list_cases()]


@router.post("/cases/{key}/install/", dependencies=[Depends(RequireRole("admin"))])
async def install_case(
    key: str, session: SessionDep, user_id: CurrentUserId, tenant_id: CurrentCompanyTenantId = None
) -> dict[str, Any]:
    if key not in CASES:
        raise HTTPException(status_code=404, detail=f"Unknown business demo case {key!r}")
    try:
        result = await install_business_demo(session, key, owner_id=uuid.UUID(user_id), tenant_id=tenant_id)
    except BusinessDemoError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await session.commit()
    return result


@router.post("/cases/{key}/reinstall/", dependencies=[Depends(RequireRole("admin"))])
async def reinstall_case(
    key: str, session: SessionDep, user_id: CurrentUserId, tenant_id: CurrentCompanyTenantId = None
) -> dict[str, Any]:
    if key not in CASES:
        raise HTTPException(status_code=404, detail=f"Unknown business demo case {key!r}")
    try:
        result = await reinstall_business_demo(session, key, owner_id=uuid.UUID(user_id), tenant_id=tenant_id)
    except BusinessDemoError as exc:
        await session.rollback()
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    await session.commit()
    return result
