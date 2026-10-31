"""Recurring invoice API (mounted at /api/v1/recurring).

Endpoints:
    GET    /                       -- List templates (?status=)
    POST   /                       -- Create a template
    GET    /summary/               -- Active/paused counts, MRR and ARR per currency
    POST   /run-due/               -- Bill everything due today for this tenant (idempotent)
    GET    /{id}/                  -- One template
    PATCH  /{id}/                  -- Edit (schedule edits re-point the next run)
    DELETE /{id}/                  -- Delete the template (generated invoices stay)
    POST   /{id}/pause/            -- Pause
    POST   /{id}/resume/           -- Resume; periods missed while paused are skipped
    POST   /{id}/generate/         -- Generate the next period now
    GET    /{id}/runs/             -- Generated invoices history
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequirePermission, SessionDep
from app.modules.recurring.schemas import (
    GenerateResponse,
    RecurringCreate,
    RecurringPage,
    RecurringResponse,
    RecurringRunPage,
    RecurringSummary,
    RecurringUpdate,
)
from app.modules.recurring.service import (
    RecurringConflictError,
    RecurringNotFoundError,
    RecurringService,
    RecurringValidationError,
)
from app.modules.sales.service import SalesError

router = APIRouter(tags=["recurring"])
T = TypeVar("T")


def _svc(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> RecurringService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return RecurringService(session, tenant_id)


async def _call[T](aw: Awaitable[T]) -> T:
    try:
        return await aw
    except RecurringNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except RecurringConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except (RecurringValidationError, SalesError) as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


def _lines(lines: list) -> list[dict]:
    return [ln.model_dump(mode="json") for ln in lines]


def _page(rows: list, offset: int, limit: int) -> dict:
    return {"items": rows[offset : offset + limit], "total": len(rows), "offset": offset, "limit": limit}


@router.get("/", response_model=RecurringPage)
async def list_templates(
    _user_id: CurrentUserId,
    status_filter: str | None = Query(None, alias="status"),
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    return _page(await svc.list_templates(status_filter), offset, limit)


@router.post("/", response_model=RecurringResponse, status_code=201)
async def create_template(
    body: RecurringCreate,
    user_id: CurrentUserId,
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.manage")),
):
    data = body.model_dump(exclude={"lines"})
    return await _call(svc.create(lines=_lines(body.lines), created_by=user_id, **data))


@router.get("/summary/", response_model=RecurringSummary)
async def summary(
    _user_id: CurrentUserId,
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    return await svc.summary()


@router.post("/run-due/", response_model=list[GenerateResponse])
async def run_due(
    _user_id: CurrentUserId,
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.manage")),
):
    return [r.__dict__ for r in await _call(svc.run_due())]


@router.get("/{template_id}/", response_model=RecurringResponse)
async def get_template(
    template_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    return await _call(svc.get(template_id))


@router.patch("/{template_id}/", response_model=RecurringResponse)
async def update_template(
    template_id: uuid.UUID,
    body: RecurringUpdate,
    _user_id: CurrentUserId,
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.manage")),
):
    data = body.model_dump(exclude_unset=True, exclude={"lines"})
    lines = _lines(body.lines) if body.lines is not None else None
    return await _call(svc.update(template_id, lines=lines, **data))


@router.delete("/{template_id}/", status_code=204)
async def delete_template(
    template_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.manage")),
):
    await _call(svc.delete(template_id))


@router.post("/{template_id}/pause/", response_model=RecurringResponse)
async def pause_template(
    template_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.manage")),
):
    return await _call(svc.pause(template_id))


@router.post("/{template_id}/resume/", response_model=RecurringResponse)
async def resume_template(
    template_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.manage")),
):
    return await _call(svc.resume(template_id))


@router.post("/{template_id}/generate/", response_model=GenerateResponse)
async def generate_now(
    template_id: uuid.UUID,
    user_id: CurrentUserId,
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.manage")),
):
    res = await _call(svc.generate(template_id, created_by=user_id))
    if res.status == "failed":
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, res.detail)
    return res.__dict__


@router.get("/{template_id}/runs/", response_model=RecurringRunPage)
async def list_runs(
    template_id: uuid.UUID,
    _user_id: CurrentUserId,
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    svc: RecurringService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    return _page(await _call(svc.runs(template_id)), offset, limit)
