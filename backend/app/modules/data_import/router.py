"""Data import API (mounted at /api/v1/data-import). All rows are tenant-scoped.

Endpoints:
    GET     /targets/                   -- Targets with field definitions and presets
    GET     /templates/{target}.csv     -- Sample CSV template
    GET/POST /presets/{target}/         -- Saved mapping presets
    DELETE  /presets/item/{id}/         -- Delete a saved preset
    GET     /jobs/                      -- Import log
    POST    /jobs/                      -- Upload a file (multipart: target, file)
    GET     /jobs/{id}/                 -- One job with preview rows
    POST    /jobs/{id}/validate/        -- Dry run with row-level errors
    POST    /jobs/{id}/commit/          -- Write in one transaction
    POST    /jobs/{id}/undo/            -- Remove records created by this import
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable
from typing import Annotated, Any, TypeVar

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from pydantic import BaseModel, Field

from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequirePermission, SessionDep
from app.modules.data_import.models import ImportJob
from app.modules.data_import.parsing import PREVIEW_ROWS
from app.modules.data_import.service import DataImportService, ImportInvalid, ImportNotFound, targets_available
from app.modules.data_import.targets import TARGETS, fields_of, template_csv

router = APIRouter(tags=["data_import"])
T = TypeVar("T")
MAX_BYTES = 10 * 1024 * 1024


def _svc(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> DataImportService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return DataImportService(session, tenant_id)


Svc = Annotated[DataImportService, Depends(_svc)]
Read = Depends(RequirePermission("data_import.read"))
Write = Depends(RequirePermission("data_import.write"))


async def _call[T](aw: Awaitable[T]) -> T:
    try:
        return await aw
    except ImportNotFound as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ImportInvalid as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


class MappingIn(BaseModel):
    mapping: dict[str, str] = Field(default_factory=dict)
    options: dict[str, Any] = Field(default_factory=dict)


class PresetIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    mapping: dict[str, str]


def _job_out(job: ImportJob, preview: bool = False) -> dict[str, Any]:
    out = {
        "id": str(job.id), "target": job.target, "filename": job.filename, "status": job.status,
        "encoding": job.encoding, "delimiter": job.delimiter, "headers": job.headers, "mapping": job.mapping,
        "options": job.options, "summary": job.summary, "row_count": job.row_count,
        "created_at": job.created_at.isoformat() if job.created_at else None,
    }
    if preview:
        out["preview"] = job.rows[:PREVIEW_ROWS]
    return out


@router.get("/targets/")
async def list_targets(_user_id: CurrentUserId, _perm: None = Read):
    return [
        {"key": t, "label": TARGETS[t]["label"],
         "fields": [{"key": f.key, "label": f.label, "kind": f.kind, "required": f.required} for f in fields_of(t)]}
        for t in targets_available()
    ]


@router.get("/templates/{target}.csv")
async def template(target: str, _user_id: CurrentUserId, _perm: None = Read):
    if target not in TARGETS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown target")
    return Response(
        content="﻿" + template_csv(target), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="import-{target}-template.csv"'},
    )


@router.get("/presets/{target}/")
async def list_presets(target: str, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.list_presets(target)


@router.post("/presets/{target}/", status_code=201)
async def save_preset(target: str, body: PresetIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    p = await _call(svc.save_preset(target, body.name, body.mapping))
    return {"id": str(p.id), "name": p.name, "mapping": p.mapping, "builtin": False}


@router.delete("/presets/item/{preset_id}/", status_code=204)
async def delete_preset(preset_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    await _call(svc.delete_preset(preset_id))
    return Response(status_code=204)


@router.get("/jobs/")
async def list_jobs(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return [_job_out(j) for j in await svc.list_jobs()]


@router.post("/jobs/", status_code=201)
async def upload(
    user_id: CurrentUserId,
    svc: Svc,
    target: Annotated[str, Form()],
    file: Annotated[UploadFile, File()],
    _perm: None = Write,
):
    raw = await file.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "File is larger than 10 MB")
    job = await _call(svc.create_job(target, file.filename or "upload.csv", raw, created_by=user_id))
    return _job_out(job, preview=True)


@router.get("/jobs/{job_id}/")
async def get_job(job_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return _job_out(await _call(svc.get_job(job_id)), preview=True)


@router.post("/jobs/{job_id}/validate/")
async def validate(job_id: uuid.UUID, body: MappingIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.validate(job_id, body.mapping, body.options))


@router.post("/jobs/{job_id}/commit/")
async def commit(job_id: uuid.UUID, body: MappingIn, user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.commit(job_id, body.mapping, body.options, created_by=user_id))


@router.post("/jobs/{job_id}/undo/")
async def undo(job_id: uuid.UUID, user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.undo(job_id, created_by=user_id))
