"""Items API routes (mounted at /api/v1/items). All rows are tenant-scoped.

Endpoints:
    GET/POST           /categories/                -- List / create categories
    PATCH/DELETE       /categories/{id}/           -- Edit / delete a category
    GET/POST           /price-lists/               -- List / create price lists (with qty breaks)
    GET/PATCH/DELETE   /price-lists/{id}/          -- One price list
    GET/POST           /discount-rules/            -- List / create discount rules
    PATCH/DELETE       /discount-rules/{id}/       -- Edit / delete a discount rule
    GET                /price/                     -- Resolve unit price (item + customer + qty + date)
    POST               /import/                    -- Bulk upsert items by SKU
    GET                /stats/                     -- Catalogue KPIs
    GET                /categories/counts/         -- Items per category
    POST               /bulk/                      -- Bulk status / category / tax / price change
    POST               /{id}/duplicate/            -- Copy an item under a new SKU
    GET                /{id}/sales-history/        -- Sales lines for the item
    GET                /{id}/purchases/            -- Purchase order lines for the item
    GET                /{id}/price-breaks/         -- Price list entries for the item
    GET/POST           /                           -- Search / create items
    GET/PATCH/DELETE   /{id}/                      -- One item
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal, TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequirePermission, SessionDep
from app.modules.items.schemas import (
    BulkIn,
    BulkResult,
    CategoryCount,
    CategoryIn,
    CategoryResponse,
    CategoryUpdate,
    DiscountRuleIn,
    DiscountRuleResponse,
    DiscountRuleUpdate,
    ImportResult,
    ItemIn,
    ItemPage,
    ItemPriceBreakRow,
    ItemResponse,
    ItemStats,
    ItemUpdate,
    PriceListIn,
    PriceListResponse,
    PriceListUpdate,
    PriceQuote,
    PurchaseHistoryRow,
    SalesHistoryRow,
)
from app.modules.items.service import (
    ItemsConflictError,
    ItemsNotFoundError,
    ItemsService,
    ItemsValidationError,
)

router = APIRouter(tags=["items"])
SortKey = Literal["sku", "name", "sales_price", "purchase_cost", "item_type", "uom", "tax_code", "updated_at", "margin"]
T = TypeVar("T")


def _svc(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> ItemsService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return ItemsService(session, tenant_id)


Svc = Annotated[ItemsService, Depends(_svc)]
Read = Depends(RequirePermission("items.read"))
Write = Depends(RequirePermission("items.write"))
Manage = Depends(RequirePermission("items.manage"))


async def _call(aw: Awaitable[T]) -> T:
    try:
        return await aw
    except ItemsNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except ItemsConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except ItemsValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


# ── Categories ────────────────────────────────────────────────────────────
@router.get("/categories/", response_model=list[CategoryResponse])
async def list_categories(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.list_categories()


@router.post("/categories/", response_model=CategoryResponse, status_code=201)
async def create_category(body: CategoryIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.create_category(**body.model_dump()))


@router.get("/categories/counts/", response_model=list[CategoryCount])
async def category_counts(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.category_counts()


@router.patch("/categories/{cat_id}/", response_model=CategoryResponse)
async def update_category(
    cat_id: uuid.UUID, body: CategoryUpdate, _user_id: CurrentUserId, svc: Svc, _perm: None = Write
):
    return await _call(svc.update_category(cat_id, **body.model_dump(exclude_unset=True)))


@router.delete("/categories/{cat_id}/", status_code=204)
async def delete_category(cat_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    await _call(svc.delete_category(cat_id))
    return Response(status_code=204)


# ── Price lists ───────────────────────────────────────────────────────────
@router.get("/price-lists/", response_model=list[PriceListResponse])
async def list_price_lists(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.list_price_lists()


@router.post("/price-lists/", response_model=PriceListResponse, status_code=201)
async def create_price_list(body: PriceListIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    data = body.model_dump(exclude={"items"})
    return await _call(svc.create_price_list(items=[r.model_dump() for r in body.items], **data))


@router.get("/price-lists/{pl_id}/", response_model=PriceListResponse)
async def get_price_list(pl_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.get_price_list(pl_id))


@router.patch("/price-lists/{pl_id}/", response_model=PriceListResponse)
async def update_price_list(
    pl_id: uuid.UUID, body: PriceListUpdate, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage
):
    data = body.model_dump(exclude_unset=True, exclude={"items"})
    items = [r.model_dump() for r in body.items] if body.items is not None else None
    return await _call(svc.update_price_list(pl_id, items=items, **data))


@router.delete("/price-lists/{pl_id}/", status_code=204)
async def delete_price_list(pl_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    await _call(svc.delete_price_list(pl_id))
    return Response(status_code=204)


# ── Discount rules ────────────────────────────────────────────────────────
@router.get("/discount-rules/", response_model=list[DiscountRuleResponse])
async def list_discount_rules(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.list_discount_rules()


@router.post("/discount-rules/", response_model=DiscountRuleResponse, status_code=201)
async def create_discount_rule(body: DiscountRuleIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    return await _call(svc.create_discount_rule(**body.model_dump()))


@router.patch("/discount-rules/{rule_id}/", response_model=DiscountRuleResponse)
async def update_discount_rule(
    rule_id: uuid.UUID, body: DiscountRuleUpdate, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage
):
    return await _call(svc.update_discount_rule(rule_id, **body.model_dump(exclude_unset=True)))


@router.delete("/discount-rules/{rule_id}/", status_code=204)
async def delete_discount_rule(rule_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Manage):
    await _call(svc.delete_discount_rule(rule_id))
    return Response(status_code=204)


# ── Price resolution / import ─────────────────────────────────────────────
@router.get("/price/", response_model=PriceQuote)
async def resolve_price(
    item_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: Svc,
    qty: Decimal = Query(Decimal(1), gt=0),
    on_date: date | None = None,
    customer_id: uuid.UUID | None = None,
    customer_group: str = "",
    currency: str | None = Query(None, min_length=3, max_length=3),
    _perm: None = Read,
):
    res = await _call(svc.resolve_price(item_id, qty, on_date, customer_id, customer_group, currency))
    return PriceQuote(**res.__dict__)


@router.post("/import/", response_model=ImportResult)
async def import_items(body: list[ItemIn], user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    created, updated = await _call(svc.import_items([r.model_dump() for r in body], created_by=user_id))
    return ImportResult(created=created, updated=updated)


@router.get("/stats/", response_model=ItemStats)
async def item_stats(_user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await svc.stats()


@router.post("/bulk/", response_model=BulkResult)
async def bulk_items(body: BulkIn, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return BulkResult(affected=await _call(svc.bulk(**body.model_dump())))


# ── Items ─────────────────────────────────────────────────────────────────
@router.get("/", response_model=ItemPage)
async def list_items(
    _user_id: CurrentUserId,
    svc: Svc,
    q: str | None = None,
    item_type: str | None = None,
    category_id: uuid.UUID | None = None,
    active: bool | None = None,
    tax_code: str | None = None,
    min_price: Decimal | None = Query(None, ge=0),
    max_price: Decimal | None = Query(None, ge=0),
    alert: Literal["below_min", "no_price"] | None = None,
    sort: SortKey = "sku",
    desc: bool = False,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    _perm: None = Read,
):
    rows, total = await _call(
        svc.list_items(q, item_type, category_id, active, limit, offset, tax_code, min_price, max_price, alert, sort, desc)
    )
    on_hand = await svc.on_hand([r.id for r in rows if r.stock_tracked])
    return ItemPage(items=rows, total=total, on_hand=on_hand)


@router.post("/", response_model=ItemResponse, status_code=201)
async def create_item(body: ItemIn, user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.create_item(created_by=user_id, **body.model_dump()))


@router.get("/{item_id}/", response_model=ItemResponse)
async def get_item(item_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.get_item(item_id))


@router.post("/{item_id}/duplicate/", response_model=ItemResponse, status_code=201)
async def duplicate_item(item_id: uuid.UUID, user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.duplicate_item(item_id, created_by=user_id))


@router.get("/{item_id}/sales-history/", response_model=list[SalesHistoryRow])
async def item_sales_history(item_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.sales_history(item_id))


@router.get("/{item_id}/purchases/", response_model=list[PurchaseHistoryRow])
async def item_purchases(item_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.purchase_history(item_id))


@router.get("/{item_id}/price-breaks/", response_model=list[ItemPriceBreakRow])
async def item_price_breaks(item_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Read):
    return await _call(svc.item_price_breaks(item_id))


@router.patch("/{item_id}/", response_model=ItemResponse)
async def update_item(item_id: uuid.UUID, body: ItemUpdate, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    return await _call(svc.update_item(item_id, **body.model_dump(exclude_unset=True)))


@router.delete("/{item_id}/", status_code=204)
async def delete_item(item_id: uuid.UUID, _user_id: CurrentUserId, svc: Svc, _perm: None = Write):
    await _call(svc.delete_item(item_id))
    return Response(status_code=204)
