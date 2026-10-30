"""Purchasing API routes (mounted at /api/v1/purchasing).

Endpoints:
    GET/POST          /orders/                      -- List / create draft PO
    GET/PATCH/DELETE  /orders/{id}/                 -- One PO / edit draft / delete draft
    POST              /orders/{id}/status/          -- confirmed | cancelled | closed
    POST              /orders/{id}/receive/         -- Post (partial) goods receipt: DR inventory|expense / CR GRNI
    POST              /orders/{id}/bill/            -- Draft bill for received-not-billed qty
    GET               /receipts/[{id}/]             -- Goods receipts
    POST              /receipts/{id}/bill/          -- Draft bill from a receipt
    GET/POST          /{bills|credit-notes}/        -- List / create draft
    GET/PATCH/DELETE  /{bills|credit-notes}/{id}/   -- One / edit draft / delete draft
    POST              /{bills|credit-notes}/{id}/post/    -- Post to GL (3-way match re-evaluated)
    POST              /{bills|credit-notes}/{id}/cancel/  -- Cancel (reverses GL when posted, unpaid)
    POST              /bills/{id}/payments/         -- Record payment: DR payables / CR bank
    GET               /stock/                       -- On-hand per stock-tracked item
    GET               /summary/                     -- Dashboard KPIs
    GET               /stats/                       -- List-page KPIs
    POST              /orders/bulk/, /{kind}/bulk/  -- mark_sent | delete_drafts | reminder_drafts
    POST              /orders/{id}/duplicate/, /{kind}/{id}/duplicate/
    GET               /orders/{id}/activity|related|pdf/, /{kind}/{id}/activity|related|pdf/
    GET/PUT           /settings/accounts/           -- GL account mapping
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable
from datetime import date
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status

from app.core.content_disposition import attachment_disposition
from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequirePermission, SessionDep
from app.modules.purchasing import pdf as po_pdf
from app.modules.purchasing.schemas import (
    AccountMapping,
    ActivityEvent,
    BillRelated,
    BulkRequest,
    BulkResponse,
    OrderRelated,
    PurchasingStats,
    BillCreate,
    BillResponse,
    BillSummary,
    BillUpdate,
    OrderCreate,
    OrderResponse,
    OrderSummary,
    OrderUpdate,
    PaymentCreate,
    ReceiptResponse,
    ReceiveRequest,
    StatusRequest,
    StockResponse,
)
from app.modules.purchasing.service import (
    LineData,
    PurchasingConflictError,
    PurchasingNotFoundError,
    PurchasingService,
    PurchasingValidationError,
)

router = APIRouter(tags=["purchasing"])
T = TypeVar("T")
BILL_PATHS = {"bills": "bill", "credit-notes": "credit_note"}
READ = Depends(RequirePermission("purchasing.read"))
WRITE = Depends(RequirePermission("purchasing.write"))
POST = Depends(RequirePermission("purchasing.post"))


def _svc(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> PurchasingService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return PurchasingService(session, tenant_id)


def _bill_kind(kind: str) -> str:
    if kind not in BILL_PATHS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown document kind {kind}")
    return BILL_PATHS[kind]


async def _call(aw: Awaitable[T]) -> T:
    try:
        return await aw
    except PurchasingNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except PurchasingConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except PurchasingValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


def _payload(body) -> dict:
    data = {k: v for k, v in body.model_dump(exclude={"lines"}).items() if v is not None}
    if body.lines is not None:
        data["lines"] = [LineData(**ln.model_dump()) for ln in body.lines]
    return data


def _csv(v: str | None) -> list[str]:
    return [x.strip() for x in (v or "").split(",") if x.strip()]


def _company() -> dict:
    from app.modules.sales.documents.service import company_data

    return company_data()


# ── Settings / summary / stock ────────────────────────────────────────────
@router.get("/settings/accounts/", response_model=AccountMapping)
async def get_accounts(_u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await svc.account_mapping()


@router.put("/settings/accounts/", response_model=AccountMapping)
async def put_accounts(
    body: AccountMapping,
    _u: CurrentUserId,
    svc: PurchasingService = Depends(_svc),
    _p: None = Depends(RequirePermission("purchasing.manage")),
):
    return await _call(svc.set_account_mapping({k: v for k, v in body.model_dump().items() if v}))


@router.get("/summary/")
async def summary(_u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await svc.summary()


@router.get("/stats/", response_model=PurchasingStats)
async def stats(_u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await svc.stats()


@router.get("/stock/", response_model=list[StockResponse])
async def stock(_u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await svc.stock()


# ── Purchase orders ───────────────────────────────────────────────────────
@router.get("/orders/", response_model=list[OrderSummary])
async def list_orders(
    response: Response,
    _u: CurrentUserId,
    status_filter: str | None = None,  # legacy name
    status_csv: str | None = Query(None, alias="status"),
    supplier_id: uuid.UUID | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    overdue: bool | None = None,
    sort: str = "-doc_date",
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    svc: PurchasingService = Depends(_svc),
    _p: None = READ,
):
    rows, total = await _call(
        svc.query_orders(
            statuses=_csv(status_csv or status_filter), supplier_id=supplier_id, q=q, date_from=date_from,
            date_to=date_to, overdue=overdue, sort=sort, limit=limit, offset=offset,
        )
    )  # fmt: skip
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.post("/orders/bulk/", response_model=BulkResponse)
async def bulk_orders(body: BulkRequest, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE):
    return await _call(svc.bulk("order", body.action, body.ids))


@router.post("/orders/", response_model=OrderResponse, status_code=201)
async def create_order(body: OrderCreate, user_id: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE):
    data = _payload(body)
    return await _call(svc.create_order(lines=data.pop("lines", []), created_by=user_id, **data))


@router.get("/orders/{order_id}/", response_model=OrderResponse)
async def get_order(order_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await _call(svc.get_order(order_id))


@router.patch("/orders/{order_id}/", response_model=OrderResponse)
async def update_order(
    order_id: uuid.UUID, body: OrderUpdate, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE
):
    return await _call(svc.update_order(order_id, **_payload(body)))


@router.delete("/orders/{order_id}/", status_code=204)
async def delete_order(order_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE):
    await _call(svc.delete_order(order_id))
    return Response(status_code=204)


@router.post("/orders/{order_id}/status/", response_model=OrderResponse)
async def order_status(
    order_id: uuid.UUID, body: StatusRequest, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE
):
    return await _call(svc.set_order_status(order_id, body.status))


@router.post("/orders/{order_id}/receive/", response_model=ReceiptResponse, status_code=201)
async def receive(
    order_id: uuid.UUID,
    body: ReceiveRequest,
    user_id: CurrentUserId,
    svc: PurchasingService = Depends(_svc),
    _p: None = POST,
):
    qty = None if body.lines is None else {ln.order_line_id: ln.qty for ln in body.lines}
    return await _call(svc.receive(order_id, qty, doc_date=body.doc_date, notes=body.notes, created_by=user_id))


@router.post("/orders/{order_id}/duplicate/", response_model=OrderResponse, status_code=201)
async def duplicate_order(order_id: uuid.UUID, user_id: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE):
    return await _call(svc.duplicate_order(order_id, created_by=user_id))


@router.get("/orders/{order_id}/activity/", response_model=list[ActivityEvent])
async def order_activity(order_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await _call(svc.order_activity(order_id))


@router.get("/orders/{order_id}/related/", response_model=OrderRelated)
async def order_related(order_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await _call(svc.order_related(order_id))


@router.get("/orders/{order_id}/pdf/")
async def order_pdf(order_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    po = await _call(svc.get_order(order_id))
    return Response(
        po_pdf.render_pdf(po, "order", _company()),
        media_type="application/pdf",
        headers={"Content-Disposition": attachment_disposition(po_pdf.filename("order", po.number), inline=True),
                 "Content-Language": "en"},
    )


@router.post("/orders/{order_id}/bill/", response_model=BillResponse, status_code=201)
async def bill_from_order(order_id: uuid.UUID, user_id: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE):
    return await _call(svc.bill_from_order(order_id, created_by=user_id))


# ── Receipts ──────────────────────────────────────────────────────────────
@router.get("/receipts/", response_model=list[ReceiptResponse])
async def list_receipts(
    _u: CurrentUserId, order_id: uuid.UUID | None = None, svc: PurchasingService = Depends(_svc), _p: None = READ
):
    return await svc.list_receipts(order_id)


@router.get("/receipts/{receipt_id}/", response_model=ReceiptResponse)
async def get_receipt(receipt_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await _call(svc.get_receipt(receipt_id))


@router.post("/receipts/{receipt_id}/bill/", response_model=BillResponse, status_code=201)
async def bill_from_receipt(
    receipt_id: uuid.UUID, user_id: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE
):
    return await _call(svc.bill_from_receipt(receipt_id, created_by=user_id))


# ── Bills / credit notes ──────────────────────────────────────────────────
@router.post("/bills/{bill_id}/payments/", response_model=BillResponse, status_code=201)
async def record_payment(
    bill_id: uuid.UUID, body: PaymentCreate, user_id: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = POST
):
    return await _call(svc.record_payment(bill_id, created_by=user_id, **body.model_dump()))


@router.get("/{kind}/", response_model=list[BillSummary])
async def list_bills(
    kind: str,
    response: Response,
    _u: CurrentUserId,
    status_filter: str | None = None,  # legacy name
    status_csv: str | None = Query(None, alias="status"),
    supplier_id: uuid.UUID | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    overdue: bool | None = None,
    match: str | None = None,
    sort: str = "-doc_date",
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    svc: PurchasingService = Depends(_svc),
    _p: None = READ,
):
    rows, total = await _call(
        svc.query_bills(
            _bill_kind(kind), statuses=_csv(status_csv or status_filter), supplier_id=supplier_id, q=q,
            date_from=date_from, date_to=date_to, overdue=overdue, match=_csv(match), sort=sort,
            limit=limit, offset=offset,
        )
    )  # fmt: skip
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.post("/{kind}/bulk/", response_model=BulkResponse)
async def bulk_bills(kind: str, body: BulkRequest, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE):
    return await _call(svc.bulk(_bill_kind(kind), body.action, body.ids))


@router.post("/{kind}/", response_model=BillResponse, status_code=201)
async def create_bill(
    kind: str, body: BillCreate, user_id: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE
):
    data = _payload(body)
    return await _call(svc.create_bill(_bill_kind(kind), lines=data.pop("lines", []), created_by=user_id, **data))


@router.get("/{kind}/{bill_id}/", response_model=BillResponse)
async def get_bill(kind: str, bill_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await _call(svc.get_bill(bill_id, _bill_kind(kind)))


@router.patch("/{kind}/{bill_id}/", response_model=BillResponse)
async def update_bill(
    kind: str,
    bill_id: uuid.UUID,
    body: BillUpdate,
    _u: CurrentUserId,
    svc: PurchasingService = Depends(_svc),
    _p: None = WRITE,
):
    await _call(svc.get_bill(bill_id, _bill_kind(kind)))
    return await _call(svc.update_bill(bill_id, **_payload(body)))


@router.delete("/{kind}/{bill_id}/", status_code=204)
async def delete_bill(kind: str, bill_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE):
    await _call(svc.get_bill(bill_id, _bill_kind(kind)))
    await _call(svc.delete_bill(bill_id))
    return Response(status_code=204)


@router.post("/{kind}/{bill_id}/post/", response_model=BillResponse)
async def post_bill(kind: str, bill_id: uuid.UUID, user_id: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = POST):
    await _call(svc.get_bill(bill_id, _bill_kind(kind)))
    return await _call(svc.post_bill(bill_id, created_by=user_id))


@router.post("/{kind}/{bill_id}/cancel/", response_model=BillResponse)
async def cancel_bill(kind: str, bill_id: uuid.UUID, user_id: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = POST):
    await _call(svc.get_bill(bill_id, _bill_kind(kind)))
    return await _call(svc.cancel_bill(bill_id, created_by=user_id))


@router.post("/{kind}/{bill_id}/duplicate/", response_model=BillResponse, status_code=201)
async def duplicate_bill(
    kind: str, bill_id: uuid.UUID, user_id: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = WRITE
):
    return await _call(svc.duplicate_bill(bill_id, _bill_kind(kind), created_by=user_id))


@router.get("/{kind}/{bill_id}/activity/", response_model=list[ActivityEvent])
async def bill_activity(kind: str, bill_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await _call(svc.bill_activity(bill_id, _bill_kind(kind)))


@router.get("/{kind}/{bill_id}/related/", response_model=BillRelated)
async def bill_related(kind: str, bill_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    return await _call(svc.bill_related(bill_id, _bill_kind(kind)))


@router.get("/{kind}/{bill_id}/pdf/")
async def bill_pdf(kind: str, bill_id: uuid.UUID, _u: CurrentUserId, svc: PurchasingService = Depends(_svc), _p: None = READ):
    bill = await _call(svc.get_bill(bill_id, _bill_kind(kind)))
    return Response(
        po_pdf.render_pdf(bill, bill.kind, _company()),
        media_type="application/pdf",
        headers={"Content-Disposition": attachment_disposition(po_pdf.filename(bill.kind, bill.number), inline=True),
                 "Content-Language": "en"},
    )
