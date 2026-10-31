"""Inventory API routes (mounted at /api/v1/inventory). All rows are tenant-scoped.

Endpoints:
    GET/POST      /warehouses/               -- List / create warehouses (default auto-created)
    PATCH         /warehouses/{id}/          -- Edit, set default, deactivate
    GET           /stock/                    -- Stock levels per item (filters: warehouse_id, q, low_only)
    GET           /items/{item_id}/          -- On hand per warehouse + recent movements for one item
    GET           /movements/                -- Movement ledger (filters, paging via limit/offset)
    POST          /transfers/                -- Move stock between warehouses
    POST          /adjustments/              -- Manual adjustment (GL) or opening stock (no GL)
    GET/POST      /stocktakes/               -- Count sheets
    GET/DELETE    /stocktakes/{id}/          -- One count sheet (delete: drafts only)
    PUT           /stocktakes/{id}/counts/   -- Enter counted quantities
    POST          /stocktakes/{id}/post/     -- Book differences (movements + GL)
    POST          /stocktakes/{id}/cancel/   -- Cancel (reverses a posted stocktake)
    GET/PUT       /settings/                 -- Negative-stock switch and GL account overrides
    GET           /summary/                  -- KPIs
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable
from datetime import date
from typing import Annotated, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequirePermission, SessionDep
from app.modules.inventory.schemas import (
    AdjustmentIn,
    CountsIn,
    InventorySummary,
    ItemStock,
    MovementPage,
    MovementResponse,
    SettingsIO,
    SettingsResponse,
    StockLevelListResponse,
    StocktakeCreate,
    StocktakeListResponse,
    StocktakeResponse,
    TransferIn,
    WarehouseIn,
    WarehouseListResponse,
    WarehouseResponse,
    WarehouseUpdate,
)
from app.modules.inventory.service import (
    InventoryConflictError,
    InventoryNotFoundError,
    InventoryService,
    InventoryValidationError,
)

router = APIRouter(tags=["inventory"])
T = TypeVar("T")


def _svc(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> InventoryService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return InventoryService(session, tenant_id)


Svc = Annotated[InventoryService, Depends(_svc)]
Read = Depends(RequirePermission("inventory.read"))
Write = Depends(RequirePermission("inventory.write"))
Manage = Depends(RequirePermission("inventory.manage"))


async def _call[T](aw: Awaitable[T]) -> T:
    try:
        return await aw
    except InventoryNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except InventoryConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except InventoryValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


def _page(rows: list, offset: int, limit: int) -> dict:
    rows = list(rows)
    return {"items": rows[offset : offset + limit], "total": len(rows), "offset": offset, "limit": limit}


# ── Warehouses ────────────────────────────────────────────────────────────
@router.get("/warehouses/", response_model=WarehouseListResponse)
async def list_warehouses(
    _user_id: CurrentUserId,
    svc: Svc,
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    _perm: None = Read,
):
    return _page(await svc.list_warehouses(), offset, limit)


@router.post("/warehouses/", response_model=WarehouseResponse, status_code=201)
async def create_warehouse(body: WarehouseIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    return await _call(svc.create_warehouse(**body.model_dump()))


@router.patch("/warehouses/{wh_id}/", response_model=WarehouseResponse)
async def update_warehouse(
    wh_id: uuid.UUID, body: WarehouseUpdate, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage
):
    return await _call(svc.update_warehouse(wh_id, **body.model_dump(exclude_unset=True)))


# ── Stock ─────────────────────────────────────────────────────────────────
@router.get("/summary/", response_model=InventorySummary)
async def summary(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.summary()


@router.get("/stock/", response_model=StockLevelListResponse)
async def stock_levels(
    _user_id: CurrentUserId,
    svc: Svc,
    warehouse_id: uuid.UUID | None = None,
    q: str | None = Query(None, max_length=100),
    low_only: bool = False,
    offset: int = Query(0, ge=0),
    limit: int = Query(500, ge=1, le=5000),
    _perm: None = Read,
):
    rows = await svc.stock_levels(warehouse_id=warehouse_id, q=q, low_only=low_only)
    return _page(rows, offset, limit)


@router.get("/items/{item_id}/", response_model=ItemStock)
async def item_stock(item_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.item_stock(item_id))


@router.get("/movements/", response_model=MovementPage)
async def list_movements(
    _user_id: CurrentUserId,
    svc: Svc,
    item_id: uuid.UUID | None = None,
    warehouse_id: uuid.UUID | None = None,
    kind: str | None = Query(None, description="Comma-separated movement kinds"),
    date_from: date | None = None,
    date_to: date | None = None,
    q: str | None = Query(None, max_length=100),
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _perm: None = Read,
):
    kinds = [k.strip() for k in (kind or "").split(",") if k.strip()]
    rows, total = await svc.list_movements(
        item_id=item_id,
        warehouse_id=warehouse_id,
        kinds=kinds or None,
        date_from=date_from,
        date_to=date_to,
        q=q,
        limit=limit,
        offset=offset,
    )
    return MovementPage(items=rows, total=total)


@router.post("/transfers/", response_model=list[MovementResponse], status_code=201)
async def transfer(body: TransferIn, user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    out, inn = await _call(
        svc.transfer(
            body.item_id,
            body.from_warehouse_id,
            body.to_warehouse_id,
            body.qty,
            move_date=body.move_date,
            notes=body.notes,
            created_by=str(user_id),
        )
    )
    return [out, inn]


@router.post("/adjustments/", response_model=MovementResponse, status_code=201)
async def adjust(body: AdjustmentIn, user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    if body.kind == "opening":
        return await _call(
            svc.opening(
                body.item_id,
                body.qty,
                body.unit_cost or 0,
                warehouse_id=body.warehouse_id,
                move_date=body.move_date,
                notes=body.notes,
                created_by=str(user_id),
            )
        )
    return await _call(
        svc.adjust(
            body.item_id,
            body.qty,
            warehouse_id=body.warehouse_id,
            unit_cost=body.unit_cost,
            move_date=body.move_date,
            notes=body.notes,
            created_by=str(user_id),
        )
    )


# ── Stocktakes ────────────────────────────────────────────────────────────
@router.get("/stocktakes/", response_model=StocktakeListResponse)
async def list_stocktakes(
    _user_id: CurrentUserId,
    svc: Svc,
    offset: int = Query(0, ge=0),
    limit: int = Query(200, ge=1, le=1000),
    _perm: None = Read,
):
    return _page(await svc.list_stocktakes(), offset, limit)


@router.post("/stocktakes/", response_model=StocktakeResponse, status_code=201)
async def create_stocktake(body: StocktakeCreate, user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(
        svc.create_stocktake(
            body.warehouse_id,
            count_date=body.count_date,
            item_ids=body.item_ids,
            notes=body.notes,
            created_by=str(user_id),
        )
    )


@router.get("/stocktakes/{st_id}/", response_model=StocktakeResponse)
async def get_stocktake(st_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.get_stocktake(st_id))


@router.put("/stocktakes/{st_id}/counts/", response_model=StocktakeResponse)
async def update_counts(st_id: uuid.UUID, body: CountsIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.update_counts(st_id, {c.line_id: c.counted_qty for c in body.counts}, body.notes))


@router.post("/stocktakes/{st_id}/post/", response_model=StocktakeResponse)
async def post_stocktake(st_id: uuid.UUID, user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    return await _call(svc.post_stocktake(st_id, created_by=str(user_id)))


@router.post("/stocktakes/{st_id}/cancel/", response_model=StocktakeResponse)
async def cancel_stocktake(st_id: uuid.UUID, user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    return await _call(svc.cancel_stocktake(st_id, created_by=str(user_id)))


@router.delete("/stocktakes/{st_id}/", status_code=204)
async def delete_stocktake(st_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    await _call(svc.delete_stocktake(st_id))
    return Response(status_code=204)


# ── Settings ──────────────────────────────────────────────────────────────
async def _settings_out(svc: InventoryService) -> SettingsResponse:
    st = await svc.settings()
    return SettingsResponse(
        allow_negative=st.allow_negative,
        inventory_account=st.inventory_account,
        cogs_account=st.cogs_account,
        diff_account=st.diff_account,
        effective=await svc.account_codes(),
    )


@router.get("/settings/", response_model=SettingsResponse)
async def get_settings(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _settings_out(svc)


@router.put("/settings/", response_model=SettingsResponse)
async def put_settings(body: SettingsIO, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    await _call(svc.update_settings(**body.model_dump(exclude_unset=True)))
    return await _settings_out(svc)
