"""Receivables API routes (mounted at /api/v1/receivables).

Endpoints:
    GET       /aging/                         -- Aging buckets per customer
    GET       /statement/?partner_key=        -- Customer statement PDF
    GET/PUT   /levels/                        -- Dunning levels (days, fee, texts)
    GET/PUT   /settings/                      -- Fee / interest switches (off by default)
    GET/POST  /blocks/   DELETE /blocks/{id}/ -- Customers excluded from dunning
    GET/POST  /runs/     GET /runs/{id}/      -- Dunning runs (draft proposals)
    PATCH     /letters/{id}/                  -- Edit a draft
    POST      /letters/{id}/decision/         -- Approve or discard (nothing is sent)
    GET       /history/                       -- Approved letters
    GET       /runs/preview/                  -- What a run would draft now (nothing stored)
    GET       /customer/?partner_key=         -- Customer drill-down
    GET/POST  /followups/  PATCH/DELETE /followups/{id}/ -- Notes and payment promises
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable
from datetime import date
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException, Response, status

from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequirePermission, SessionDep
from app.modules.receivables import schemas as S  # noqa: N812
from app.modules.receivables.customer import CustomerAccountService, followup_out
from app.modules.receivables.service import (
    INTEREST_RATE_HINT,
    ReceivablesConflictError,
    ReceivablesNotFoundError,
    ReceivablesService,
    ReceivablesValidationError,
)

router = APIRouter(tags=["receivables"])
T = TypeVar("T")


def _svc(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> ReceivablesService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return ReceivablesService(session, tenant_id)


async def _call[T](aw: Awaitable[T]) -> T:
    try:
        return await aw
    except ReceivablesNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ReceivablesConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except ReceivablesValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


def _cust(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> CustomerAccountService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return CustomerAccountService(session, tenant_id)


READ = Depends(RequirePermission("receivables.read"))
WRITE = Depends(RequirePermission("receivables.write"))
MANAGE = Depends(RequirePermission("receivables.manage"))


@router.get("/aging/")
async def aging(_u: CurrentUserId, as_of: date | None = None, svc: ReceivablesService = Depends(_svc), _p: None = READ):
    return await svc.aging(as_of)


@router.get("/statement/")
async def statement(
    partner_key: str,
    _u: CurrentUserId,
    as_of: date | None = None,
    svc: ReceivablesService = Depends(_svc),
    _p: None = READ,
):
    pdf = await _call(svc.statement_pdf(partner_key, as_of))
    return Response(
        pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": "attachment; filename=statement.pdf", "Content-Language": "en"},
    )


@router.get("/levels/", response_model=list[S.LevelIO])
async def get_levels(_u: CurrentUserId, svc: ReceivablesService = Depends(_svc), _p: None = READ):
    return await svc.levels()


@router.put("/levels/", response_model=list[S.LevelIO])
async def put_levels(
    body: list[S.LevelIO], _u: CurrentUserId, svc: ReceivablesService = Depends(_svc), _p: None = MANAGE
):
    return await _call(svc.set_levels([lv.model_dump() for lv in body]))


@router.get("/settings/")
async def get_settings(_u: CurrentUserId, svc: ReceivablesService = Depends(_svc), _p: None = READ):
    cfg = await svc.settings()
    return {**S.SettingsIO.model_validate(cfg).model_dump(), "interest_rate_hint": INTEREST_RATE_HINT}


@router.put("/settings/", response_model=S.SettingsIO)
async def put_settings(
    body: S.SettingsIO, _u: CurrentUserId, svc: ReceivablesService = Depends(_svc), _p: None = MANAGE
):
    return await svc.update_settings(**body.model_dump())


@router.get("/blocks/", response_model=list[S.BlockOut])
async def list_blocks(_u: CurrentUserId, svc: ReceivablesService = Depends(_svc), _p: None = READ):
    return await svc.blocks()


@router.post("/blocks/", response_model=S.BlockOut, status_code=201)
async def add_block(body: S.BlockIn, user_id: CurrentUserId, svc: ReceivablesService = Depends(_svc), _p: None = WRITE):
    return await svc.block(body.partner_key, body.customer_name, body.reason, user_id)


@router.delete("/blocks/{block_id}/", status_code=204)
async def remove_block(
    block_id: uuid.UUID, _u: CurrentUserId, svc: ReceivablesService = Depends(_svc), _p: None = WRITE
):
    await _call(svc.unblock(block_id))
    return Response(status_code=204)


@router.get("/runs/", response_model=list[S.RunOut])
async def list_runs(_u: CurrentUserId, svc: ReceivablesService = Depends(_svc), _p: None = READ):
    return await svc.list_runs()


@router.post("/runs/", response_model=S.RunOut, status_code=201)
async def create_run(body: S.RunIn, user_id: CurrentUserId, svc: ReceivablesService = Depends(_svc), _p: None = WRITE):
    return await svc.propose_run(body.as_of, user_id)


@router.get("/runs/preview/")
async def preview_run(
    _u: CurrentUserId,
    as_of: date | None = None,
    partner_key: str | None = None,
    svc: ReceivablesService = Depends(_svc),
    _p: None = READ,
):
    return await svc.preview_run(as_of, partner_key)


@router.get("/runs/{run_id}/", response_model=S.RunOut)
async def get_run(run_id: uuid.UUID, _u: CurrentUserId, svc: ReceivablesService = Depends(_svc), _p: None = READ):
    return await _call(svc.get_run(run_id))


@router.patch("/letters/{letter_id}/", response_model=S.LetterOut)
async def update_letter(
    letter_id: uuid.UUID,
    body: S.LetterUpdate,
    _u: CurrentUserId,
    svc: ReceivablesService = Depends(_svc),
    _p: None = WRITE,
):
    return await _call(svc.update_letter(letter_id, **body.model_dump()))


@router.post("/letters/{letter_id}/decision/", response_model=S.LetterOut)
async def decide(
    letter_id: uuid.UUID,
    body: S.DecisionIn,
    user_id: CurrentUserId,
    svc: ReceivablesService = Depends(_svc),
    _p: None = WRITE,
):
    return await _call(svc.decide(letter_id, body.decision, user_id))


@router.post("/letters/{letter_id}/send/", response_model=S.LetterSendOut)
async def send_letter(
    letter_id: uuid.UUID,
    body: S.LetterSendIn,
    user_id: CurrentUserId,
    svc: ReceivablesService = Depends(_svc),
    _p: None = WRITE,
):
    from app.core.mail_settings import mail_service, mail_status

    if not mail_status()["configured"]:
        raise HTTPException(status.HTTP_409_CONFLICT, "Outbound mail is not configured")
    letter, result = await _call(svc.send_letter(letter_id, email=mail_service(), to=body.to, cc=body.cc, by=user_id))
    return {"letter": S.LetterOut.model_validate(letter), "ok": result.ok, "reason": result.reason}


@router.get("/history/", response_model=list[S.LetterOut])
async def history(
    _u: CurrentUserId, partner_key: str | None = None, svc: ReceivablesService = Depends(_svc), _p: None = READ
):
    return await svc.history(partner_key)


@router.get("/customer/")
async def customer_detail(
    partner_key: str,
    _u: CurrentUserId,
    as_of: date | None = None,
    svc: CustomerAccountService = Depends(_cust),
    _p: None = READ,
):
    out = await _call(svc.detail(partner_key, as_of))
    out["letters"] = [S.LetterOut.model_validate(lt).model_dump() for lt in out["letters"]]
    return out


@router.get("/followups/")
async def list_followups(
    _u: CurrentUserId,
    partner_key: str | None = None,
    status_filter: str | None = "open",
    svc: CustomerAccountService = Depends(_cust),
    _p: None = READ,
):
    rows = await svc.followups(partner_key) if partner_key else await svc.promises(status_filter or None)
    return [followup_out(f) for f in rows]


@router.post("/followups/", status_code=201)
async def add_followup(
    body: S.FollowUpIn, user_id: CurrentUserId, svc: CustomerAccountService = Depends(_cust), _p: None = WRITE
):
    return followup_out(await _call(svc.add(body.model_dump(), user_id)))


@router.patch("/followups/{followup_id}/")
async def set_followup_status(
    followup_id: uuid.UUID,
    body: S.FollowUpStatusIn,
    _u: CurrentUserId,
    svc: CustomerAccountService = Depends(_cust),
    _p: None = WRITE,
):
    return followup_out(await _call(svc.set_status(followup_id, body.status)))


@router.delete("/followups/{followup_id}/", status_code=204)
async def delete_followup(
    followup_id: uuid.UUID, _u: CurrentUserId, svc: CustomerAccountService = Depends(_cust), _p: None = WRITE
):
    await _call(svc.delete(followup_id))
    return Response(status_code=204)
