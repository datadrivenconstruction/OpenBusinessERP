"""Banking API routes (mounted at /api/v1/banking).

Endpoints:
    GET/POST  /accounts/                              -- List / create bank accounts
    PATCH     /accounts/{id}/                         -- Edit an account
    POST      /accounts/{id}/import/                  -- Upload a statement (camt.053/054, MT940, CSV)
    GET       /transactions/                          -- Lines (filter account_id, status)
    GET       /transactions/{id}/suggestions/         -- Ranked match suggestions
    POST      /transactions/{id}/confirm/             -- Post confirmed allocation(s)
    POST      /transactions/{id}/manual-entry/        -- Book line against any GL account
    POST      /transactions/{id}/ignore/              -- Ignore / un-ignore a line
    GET       /open-items/                            -- Open invoices and bills
    GET/PUT   /settings/                              -- Tolerance, date window, write-off account
    GET       /summary/                               -- KPI strip: balances, open lines, matched this month
    POST      /accounts/{id}/preview/                 -- Dry-run an import: rows, duplicates, rule hits
    POST      /transactions/bulk-accept/              -- Confirm every unambiguous high-confidence match
    GET       /transactions/{id}/rule/                -- First categorisation rule matching a line
    GET/POST  /rules/, PATCH/DELETE /rules/{id}/      -- Categorisation rules
    POST      /rules/apply/                           -- Book matching open lines (or dry-run)
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Awaitable
from typing import TypeVar

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status

from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequirePermission, SessionDep
from app.modules.banking import schemas as S
from app.modules.banking.service import (
    AllocationIn,
    BankingConflictError,
    BankingNotFoundError,
    BankingValidationError,
)
from app.modules.banking.workspace import BankingWorkspace as BankingService

router = APIRouter(tags=["banking"])
T = TypeVar("T")
MAX_UPLOAD = 10 * 1024 * 1024


def _svc(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> BankingService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return BankingService(session, tenant_id)


async def _call(aw: Awaitable[T]) -> T:
    try:
        return await aw
    except BankingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except BankingConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except BankingValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


async def _read_upload(file: UploadFile, mapping: str | None) -> tuple[bytes, dict | None]:
    content = await file.read(MAX_UPLOAD + 1)
    if len(content) > MAX_UPLOAD:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "Statement file is larger than 10 MB")
    try:
        parsed = json.loads(mapping) if mapping else None
    except json.JSONDecodeError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "mapping must be JSON") from exc
    if parsed is not None and not isinstance(parsed, dict):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "mapping must be a JSON object")
    return content, parsed


@router.get("/settings/", response_model=S.SettingsIO)
async def get_settings(_u: CurrentUserId, svc: BankingService = Depends(_svc),
                       _p: None = Depends(RequirePermission("banking.read"))):
    return await svc.settings()


@router.put("/settings/", response_model=S.SettingsIO)
async def put_settings(body: S.SettingsIO, _u: CurrentUserId, svc: BankingService = Depends(_svc),
                       _p: None = Depends(RequirePermission("banking.manage"))):
    return await _call(svc.update_settings(**body.model_dump()))


@router.get("/accounts/", response_model=list[S.AccountOut])
async def list_accounts(_u: CurrentUserId, svc: BankingService = Depends(_svc),
                        _p: None = Depends(RequirePermission("banking.read"))):
    return await svc.list_accounts()


@router.post("/accounts/", response_model=S.AccountOut, status_code=201)
async def create_account(body: S.AccountIn, _u: CurrentUserId, svc: BankingService = Depends(_svc),
                         _p: None = Depends(RequirePermission("banking.manage"))):
    return await _call(svc.create_account(**body.model_dump()))


@router.patch("/accounts/{account_id}/", response_model=S.AccountOut)
async def update_account(account_id: uuid.UUID, body: S.AccountUpdate, _u: CurrentUserId,
                         svc: BankingService = Depends(_svc),
                         _p: None = Depends(RequirePermission("banking.manage"))):
    return await _call(svc.update_account(account_id, **body.model_dump()))


@router.post("/accounts/{account_id}/import/", response_model=S.StatementOut, status_code=201)
async def import_statement(
    account_id: uuid.UUID,
    user_id: CurrentUserId,
    file: UploadFile = File(...),
    fmt: str | None = Form(None),
    mapping: str | None = Form(None),
    svc: BankingService = Depends(_svc),
    _p: None = Depends(RequirePermission("banking.import")),
):
    content, parsed_mapping = await _read_upload(file, mapping)
    return await _call(svc.import_statement(
        account_id, content, fmt=fmt or None, mapping=parsed_mapping, filename=file.filename or "", created_by=user_id,
    ))


@router.get("/transactions/", response_model=list[S.TransactionOut])
async def list_transactions(_u: CurrentUserId, account_id: uuid.UUID | None = None, status_filter: str | None = None,
                            svc: BankingService = Depends(_svc),
                            _p: None = Depends(RequirePermission("banking.read"))):
    return await svc.list_transactions(account_id, status_filter)


@router.get("/transactions/{txn_id}/suggestions/", response_model=list[S.SuggestionOut])
async def suggestions(txn_id: uuid.UUID, _u: CurrentUserId, svc: BankingService = Depends(_svc),
                      _p: None = Depends(RequirePermission("banking.read"))):
    out = await _call(svc.suggestions(txn_id))
    return [
        {"score": s.score, "reasons": s.reasons, "difference": s.difference, "is_split": s.is_split,
         "allocations": [vars(a) for a in s.allocations]}
        for s in out
    ]


@router.post("/transactions/{txn_id}/confirm/", response_model=S.TransactionOut)
async def confirm(txn_id: uuid.UUID, body: S.ConfirmIn, user_id: CurrentUserId, svc: BankingService = Depends(_svc),
                  _p: None = Depends(RequirePermission("banking.post"))):
    allocs = [AllocationIn(a.target_type, a.target_id, a.amount) for a in body.allocations]
    return await _call(svc.confirm(txn_id, allocs, write_off_difference=body.write_off_difference,
                                   confidence=body.confidence, created_by=user_id))


@router.post("/transactions/{txn_id}/manual-entry/", response_model=S.TransactionOut)
async def manual_entry(txn_id: uuid.UUID, body: S.ManualEntryIn, user_id: CurrentUserId,
                       svc: BankingService = Depends(_svc),
                       _p: None = Depends(RequirePermission("banking.post"))):
    return await _call(svc.manual_entry(txn_id, account_code=body.account_code, memo=body.memo,
                                        amount=body.amount, created_by=user_id))


@router.post("/transactions/{txn_id}/ignore/", response_model=S.TransactionOut)
async def ignore(txn_id: uuid.UUID, body: S.IgnoreIn, _u: CurrentUserId, svc: BankingService = Depends(_svc),
                 _p: None = Depends(RequirePermission("banking.import"))):
    return await _call(svc.set_ignored(txn_id, body.ignored))


@router.post("/transactions/{txn_id}/undo/", response_model=S.TransactionOut)
async def undo_match(txn_id: uuid.UUID, user_id: CurrentUserId, svc: BankingService = Depends(_svc),
                     _p: None = Depends(RequirePermission("banking.post"))):
    return await _call(svc.undo_match(txn_id, created_by=user_id))


@router.get("/open-items/", response_model=list[S.OpenItemOut])
async def open_items(_u: CurrentUserId, svc: BankingService = Depends(_svc),
                     _p: None = Depends(RequirePermission("banking.read"))):
    return [vars(i) for i in await svc.open_items()]


@router.get("/summary/", response_model=S.SummaryOut)
async def summary(_u: CurrentUserId, svc: BankingService = Depends(_svc),
                  _p: None = Depends(RequirePermission("banking.read"))):
    return await svc.summary()


@router.post("/accounts/{account_id}/preview/", response_model=S.PreviewOut)
async def preview_import(
    account_id: uuid.UUID,
    _u: CurrentUserId,
    file: UploadFile = File(...),
    fmt: str | None = Form(None),
    mapping: str | None = Form(None),
    svc: BankingService = Depends(_svc),
    _p: None = Depends(RequirePermission("banking.import")),
):
    content, parsed_mapping = await _read_upload(file, mapping)
    return await _call(svc.preview_import(account_id, content, fmt=fmt or None, mapping=parsed_mapping))


@router.post("/transactions/bulk-accept/", response_model=S.BulkAcceptOut)
async def bulk_accept(body: S.BulkAcceptIn, user_id: CurrentUserId, svc: BankingService = Depends(_svc),
                      _p: None = Depends(RequirePermission("banking.post"))):
    r = await _call(svc.bulk_accept(min_score=body.min_score, account_id=body.account_id, created_by=user_id))
    return {"accepted": r.accepted, "skipped": r.skipped, "errors": r.errors}


@router.get("/transactions/{txn_id}/rule/", response_model=S.RuleOut | None)
async def rule_for_line(txn_id: uuid.UUID, _u: CurrentUserId, svc: BankingService = Depends(_svc),
                        _p: None = Depends(RequirePermission("banking.read"))):
    return await _call(svc.rule_for(txn_id))


@router.get("/rules/", response_model=list[S.RuleOut])
async def list_rules(_u: CurrentUserId, svc: BankingService = Depends(_svc),
                     _p: None = Depends(RequirePermission("banking.read"))):
    return await svc.list_rules()


@router.post("/rules/", response_model=S.RuleOut, status_code=201)
async def create_rule(body: S.RuleIn, _u: CurrentUserId, svc: BankingService = Depends(_svc),
                      _p: None = Depends(RequirePermission("banking.manage"))):
    return await _call(svc.create_rule(**body.model_dump()))


@router.post("/rules/apply/", response_model=S.ApplyRulesOut)
async def apply_rules(body: S.ApplyRulesIn, user_id: CurrentUserId, svc: BankingService = Depends(_svc),
                      _p: None = Depends(RequirePermission("banking.post"))):
    return await _call(svc.apply_rules(account_id=body.account_id, dry_run=body.dry_run, created_by=user_id))


@router.patch("/rules/{rule_id}/", response_model=S.RuleOut)
async def update_rule(rule_id: uuid.UUID, body: S.RuleUpdate, _u: CurrentUserId,
                      svc: BankingService = Depends(_svc),
                      _p: None = Depends(RequirePermission("banking.manage"))):
    return await _call(svc.update_rule(rule_id, **body.model_dump(exclude_unset=True)))


@router.delete("/rules/{rule_id}/", status_code=204)
async def delete_rule(rule_id: uuid.UUID, _u: CurrentUserId, svc: BankingService = Depends(_svc),
                      _p: None = Depends(RequirePermission("banking.manage"))):
    await _call(svc.delete_rule(rule_id))
