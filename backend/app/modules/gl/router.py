# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""General Ledger API routes (mounted at /api/v1/gl).

Endpoints:
    GET    /accounts/                      -- Chart of accounts
    POST   /accounts/                      -- Create an account
    PATCH  /accounts/{id}/                 -- Update an account
    GET    /templates/                     -- Available chart templates
    POST   /templates/{key}/load/          -- Load a chart template (idempotent)
    GET    /fiscal-years/                  -- Fiscal years with periods
    POST   /fiscal-years/                  -- Create a fiscal year (monthly periods)
    POST   /periods/{id}/status/           -- Open or close a period
    GET    /entries/                       -- Journal entries
    POST   /entries/                       -- Create a draft (optionally post)
    GET    /entries/{id}/                  -- One entry
    PATCH  /entries/{id}/                  -- Edit a draft
    DELETE /entries/{id}/                  -- Delete a draft
    POST   /entries/{id}/post/             -- Post a draft
    POST   /entries/{id}/reverse/          -- Reverse a posted entry
    GET    /reports/trial-balance/         -- Trial balance for a date range
    GET    /reports/ledger/{account_id}/   -- Account ledger with running balance
    GET    /reports/balance-sheet/         -- Balance sheet as of a date
    GET    /reports/profit-loss/           -- P&L for a date range
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable
from datetime import date
from typing import Any, TypeVar

from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status

from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequirePermission, SessionDep
from app.modules.gl.schemas import (
    AccountCreate,
    AccountResponse,
    AccountUpdate,
    EntryCreate,
    EntryResponse,
    EntryUpdate,
    FiscalYearCreate,
    FiscalYearResponse,
    PeriodResponse,
    PeriodStatusRequest,
    ReverseRequest,
    TemplateLoadResponse,
)
from app.modules.gl.service import (
    GLConflictError,
    GLNotFoundError,
    GLService,
    GLValidationError,
    LineInput,
)
from app.modules.gl.templates import TEMPLATES

router = APIRouter(tags=["gl"])
T = TypeVar("T")


def _svc(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> GLService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return GLService(session, tenant_id)


async def _call(aw: Awaitable[T]) -> T:
    """Map service errors onto HTTP status codes."""
    try:
        return await aw
    except GLNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except GLConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except GLValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


def _lines(body_lines: list[Any]) -> list[LineInput]:
    return [LineInput(**ln.model_dump()) for ln in body_lines]


# ── Accounts ──────────────────────────────────────────────────────────────
@router.get("/accounts/", response_model=list[AccountResponse])
async def list_accounts(
    _user_id: CurrentUserId,
    active_only: bool = False,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
):
    return await svc.list_accounts(active_only=active_only)


@router.post("/accounts/", response_model=AccountResponse, status_code=201)
async def create_account(
    body: AccountCreate,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.manage")),
):
    return await _call(svc.create_account(**body.model_dump()))


@router.patch("/accounts/{account_id}/", response_model=AccountResponse)
async def update_account(
    account_id: uuid.UUID,
    body: AccountUpdate,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.manage")),
):
    return await _call(svc.update_account(account_id, **body.model_dump(exclude_unset=True)))


@router.get("/templates/")
async def list_templates(
    _user_id: CurrentUserId,
    _perm: None = Depends(RequirePermission("gl.read")),
) -> list[dict[str, Any]]:
    return [{"key": k, "accounts": len(v)} for k, v in TEMPLATES.items()]


@router.post("/templates/{key}/load/", response_model=TemplateLoadResponse)
async def load_template(
    key: str,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.manage")),
):
    res = await _call(svc.load_template(key))
    return TemplateLoadResponse(template=key, **res)


# ── Fiscal years / periods ────────────────────────────────────────────────
@router.get("/fiscal-years/", response_model=list[FiscalYearResponse])
async def list_fiscal_years(
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
):
    return await svc.list_fiscal_years()


@router.post("/fiscal-years/", response_model=FiscalYearResponse, status_code=201)
async def create_fiscal_year(
    body: FiscalYearCreate,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.manage")),
):
    return await _call(svc.create_fiscal_year(body.name, body.start_date, body.end_date))


@router.post("/periods/{period_id}/status/", response_model=PeriodResponse)
async def set_period_status(
    period_id: uuid.UUID,
    body: PeriodStatusRequest,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.manage")),
):
    return await _call(svc.set_period_status(period_id, body.status))


# ── Entries ───────────────────────────────────────────────────────────────
@router.get("/entries/", response_model=list[EntryResponse])
async def list_entries(
    _user_id: CurrentUserId,
    entry_status: str | None = Query(default=None, alias="status"),
    date_from: date | None = None,
    date_to: date | None = None,
    source_type: str | None = None,
    source_id: str | None = None,
    limit: int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0, ge=0),
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
):
    return await svc.list_entries(
        status=entry_status,
        date_from=date_from,
        date_to=date_to,
        source_type=source_type,
        source_id=source_id,
        limit=limit,
        offset=offset,
    )


@router.post("/entries/", response_model=EntryResponse, status_code=201)
async def create_entry(
    body: EntryCreate,
    user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.write")),
):
    # Always a draft here: posting needs gl.post via /entries/{id}/post/.
    data = body.model_dump(exclude={"lines"})
    return await _call(svc.create_entry(lines=_lines(body.lines), created_by=str(user_id), **data))


@router.get("/entries/{entry_id}/", response_model=EntryResponse)
async def get_entry(
    entry_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
):
    return await _call(svc.get_entry(entry_id))


@router.patch("/entries/{entry_id}/", response_model=EntryResponse)
async def update_entry(
    entry_id: uuid.UUID,
    body: EntryUpdate,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.write")),
):
    data = body.model_dump(exclude_unset=True, exclude={"lines"})
    if body.lines is not None:
        data["lines"] = _lines(body.lines)
    return await _call(svc.update_draft(entry_id, **data))


@router.delete("/entries/{entry_id}/", status_code=204)
async def delete_entry(
    entry_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.write")),
) -> Response:
    await _call(svc.delete_draft(entry_id))
    return Response(status_code=204)


@router.post("/entries/{entry_id}/post/", response_model=EntryResponse)
async def post_entry(
    entry_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.post")),
):
    return await _call(svc.post_entry(entry_id))


@router.post("/entries/{entry_id}/reverse/", response_model=EntryResponse, status_code=201)
async def reverse_entry(
    entry_id: uuid.UUID,
    body: ReverseRequest,
    user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.post")),
):
    return await _call(svc.reverse_entry(entry_id, on=body.on, memo=body.memo, created_by=str(user_id)))


# ── Reports ───────────────────────────────────────────────────────────────
@router.get("/reports/trial-balance/")
async def trial_balance(
    _user_id: CurrentUserId,
    date_from: date | None = None,
    date_to: date | None = None,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
) -> dict[str, Any]:
    return await svc.trial_balance(date_from, date_to)


@router.get("/reports/ledger/{account_id}/")
async def account_ledger(
    account_id: uuid.UUID,
    _user_id: CurrentUserId,
    date_from: date | None = None,
    date_to: date | None = None,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
) -> dict[str, Any]:
    return await _call(svc.account_ledger(account_id, date_from, date_to))


@router.get("/reports/balance-sheet/")
async def balance_sheet(
    _user_id: CurrentUserId,
    as_of: date = Query(...),
    compare_as_of: date | None = None,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
) -> dict[str, Any]:
    cur = await svc.balance_sheet(as_of)
    if compare_as_of:
        cur["compare"] = await svc.balance_sheet(compare_as_of)
    return cur


@router.get("/reports/profit-loss/")
async def profit_and_loss(
    _user_id: CurrentUserId,
    date_from: date | None = None,
    date_to: date | None = None,
    compare_from: date | None = None,
    compare_to: date | None = None,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
) -> dict[str, Any]:
    cur = await svc.profit_and_loss(date_from, date_to)
    if compare_from or compare_to:
        cur["compare"] = await svc.profit_and_loss(compare_from, compare_to)
    return cur


@router.get("/reports/vat/")
async def vat_report(
    _user_id: CurrentUserId,
    session: SessionDep,
    date_from: date | None = None,
    date_to: date | None = None,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
) -> dict[str, Any]:
    from app.modules.purchasing.service import PurchasingService
    from app.modules.sales.service import SalesService

    out = (await SalesService(session, svc.tenant_id).account_mapping()).get("vat")
    inp = (await PurchasingService(session, svc.tenant_id).account_mapping()).get("input_vat")
    return await svc.vat_report(date_from, date_to, [out] if out else [], [inp] if inp else [])


@router.get("/kpis/")
async def gl_kpis(
    _user_id: CurrentUserId,
    as_of: date | None = None,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
) -> dict[str, Any]:
    return await svc.kpis(as_of or date.today())


# ── Attachments ───────────────────────────────────────────────────────────
def _att(a: Any) -> dict[str, Any]:
    return {
        "id": a.id, "entry_id": a.entry_id, "filename": a.filename, "content_type": a.content_type,
        "size": a.size, "uploaded_by": a.uploaded_by, "created_at": a.created_at,
    }


@router.get("/entries/{entry_id}/attachments/")
async def list_attachments(
    entry_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
) -> list[dict[str, Any]]:
    return [_att(a) for a in await _call(svc.list_attachments(entry_id))]


@router.post("/entries/{entry_id}/attachments/", status_code=201)
async def upload_attachment(
    entry_id: uuid.UUID,
    user_id: CurrentUserId,
    file: UploadFile = File(...),
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.write")),
) -> dict[str, Any]:
    data = await file.read(GLService.MAX_ATTACHMENT + 1)
    att = await _call(svc.add_attachment(entry_id, file.filename or "file", file.content_type, data, str(user_id)))
    return _att(att)


@router.get("/attachments/{attachment_id}/download/")
async def download_attachment(
    attachment_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.read")),
) -> Response:
    a = await _call(svc.get_attachment(attachment_id))
    safe = a.filename.replace('"', "")
    return Response(a.data, media_type=a.content_type, headers={"Content-Disposition": f'attachment; filename="{safe}"'})


@router.delete("/attachments/{attachment_id}/", status_code=204)
async def delete_attachment(
    attachment_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: GLService = Depends(_svc),
    _perm: None = Depends(RequirePermission("gl.write")),
) -> Response:
    await _call(svc.delete_attachment(attachment_id))
    return Response(status_code=204)
