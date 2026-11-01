"""Sales API routes (mounted at /api/v1/sales).

Endpoints ({kind} is quotes | orders | invoices):
    GET    /{kind}/                         -- List documents
    POST   /{kind}/                         -- Create a draft
    GET    /{kind}/{id}/                    -- One document with lines and payments
    PATCH  /{kind}/{id}/                    -- Edit a draft
    DELETE /{kind}/{id}/                    -- Delete a draft
    POST   /{kind}/{id}/status/             -- Transition (invoice -> issued posts to GL)
    POST   /quotes/{id}/convert-to-order/   -- Quote -> sales order
    POST   /orders/{id}/convert-to-invoice/ -- Sales order -> invoice
    POST   /invoices/{id}/issue/            -- Issue invoice, post DR AR / CR revenue / CR VAT
    POST   /invoices/{id}/payments/         -- Record payment, post DR bank / CR AR
    POST   /invoices/{id}/credit-note/      -- Draft a credit note (status issued posts the GL reversal)
    GET    /{kind}/{id}/pdf/                -- Render the document as PDF
    GET    /invoices/{id}/dunning-pdf/      -- Payment reminder / dunning letter PDF
    GET|PUT /settings/document-design/      -- PDF template and letterhead design (+ POST preview/)
    GET    /{kind}/{id}/check/              -- Missing mandatory invoice data (a check, not a guarantee)
    GET    /{kind}/{id}/email-draft/        -- Prefilled send dialog (to, subject, body)
    POST   /{kind}/{id}/send/               -- E-mail the PDF (explicit user action), writes send log
    GET    /{kind}/{id}/sends/              -- Send history
    GET    /summary/                        -- Dashboard KPIs
    GET    /stats/                          -- List-page KPIs
    POST   /{kind}/bulk/                    -- mark_sent | delete_drafts | reminder_drafts
    POST   /{kind}/{id}/duplicate/          -- New draft copy
    GET    /{kind}/{id}/activity/           -- Derived timeline
    GET    /{kind}/{id}/related/            -- Source and derived documents
    GET    /settings/accounts/              -- Effective GL account mapping
    PUT    /settings/accounts/              -- Override GL account codes
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable
from datetime import date
from decimal import Decimal
from typing import TypeVar

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

from app.core.content_disposition import attachment_disposition
from app.core.email.service import EmailService
from app.dependencies import CurrentCompanyTenantId, CurrentUserId, RequirePermission, SessionDep
from app.modules.sales.documents import design
from app.modules.sales.documents import service as docs
from app.modules.sales.documents.checks import check_invoice
from app.modules.sales.documents.i18n import lang
from app.modules.sales.documents.pdf import render_dunning, render_sample
from app.modules.sales.schemas import (
    AccountMapping,
    ActivityEvent,
    BulkRequest,
    BulkResponse,
    ConvertRequest,
    DocumentCreate,
    DocumentResponse,
    DocumentSummary,
    DocumentUpdate,
    EmailDraft,
    InvoiceCheckIssue,
    PaymentCreate,
    RelatedResponse,
    SalesStats,
    SendLogResponse,
    SendRequest,
    StatusRequest,
)
from app.modules.sales.service import (
    LineData,
    SalesConflictError,
    SalesNotFoundError,
    SalesService,
    SalesValidationError,
)

router = APIRouter(tags=["sales"])
T = TypeVar("T")
KIND_PATHS = {"quotes": "quote", "orders": "order", "invoices": "invoice", "credit-notes": "credit_note"}


def _svc(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> SalesService:
    if tenant_id is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Tenant could not be resolved")
    return SalesService(session, tenant_id)


def _kind(kind: str) -> str:
    if kind not in KIND_PATHS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Unknown document kind {kind}")
    return KIND_PATHS[kind]


async def _call[T](aw: Awaitable[T]) -> T:
    try:
        return await aw
    except SalesNotFoundError as exc:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(exc)) from exc
    except SalesConflictError as exc:
        raise HTTPException(status.HTTP_409_CONFLICT, str(exc)) from exc
    except SalesValidationError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


def _lines(lines: list) -> list[LineData]:
    return [LineData(**ln.model_dump()) for ln in lines]


def _picked(body: ConvertRequest | None) -> list[tuple[uuid.UUID, Decimal]] | None:
    if body is None or body.lines is None:
        return None
    return [(ln.line_id, ln.qty) for ln in body.lines]


# ── Settings (declared before /{kind}/ so it is not captured) ─────────────
class DocumentDesignBody(BaseModel):
    template: str | None = None
    accent_color: str | None = None
    font: str | None = None
    logo_position: str | None = None
    logo_size: str | None = None
    footer_blocks: list[str] | None = None
    header_contact: bool | None = None
    page_numbers: bool | None = None
    din5008: bool | None = None
    fold_marks: bool | None = None
    terms_text: str | None = Field(default=None, max_length=design.MAX_TERMS)


class DesignPreviewBody(BaseModel):
    design: DocumentDesignBody = DocumentDesignBody()
    kind: str = Field("invoice", pattern="^(quote|order|invoice|credit_note|dunning|purchase_order)$")
    language: str = Field("en", max_length=5)
    lines: int = Field(6, ge=1, le=80)


@router.get("/settings/document-design/")
async def get_document_design(_user_id: CurrentUserId, _perm: None = Depends(RequirePermission("sales.read"))):
    return design.read_design()


@router.put("/settings/document-design/")
async def put_document_design(
    body: DocumentDesignBody, _user_id: CurrentUserId, _perm: None = Depends(RequirePermission("sales.manage"))
):
    return design.write_design(body.model_dump())


@router.post("/settings/document-design/preview/")
async def preview_document_design(
    body: DesignPreviewBody, _user_id: CurrentUserId, _perm: None = Depends(RequirePermission("sales.read"))
):
    """Render a sample document with an unsaved design, for the settings live preview."""
    unsaved = design.sanitise_design({**design.read_design(), **body.design.model_dump(exclude_none=True)})
    company = {**docs.company_data(), "document_design": unsaved}
    language = lang(body.language)
    pdf = await run_in_threadpool(render_sample, body.kind, company, language=language, n_lines=body.lines)
    return Response(
        pdf, media_type="application/pdf", headers={"Cache-Control": "no-store", "Content-Language": language}
    )


@router.get("/settings/accounts/", response_model=AccountMapping)
async def get_accounts(
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    return await svc.account_mapping()


@router.put("/settings/accounts/", response_model=AccountMapping)
async def put_accounts(
    body: AccountMapping,
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.manage")),
):
    return await _call(svc.set_account_mapping({k: v for k, v in body.model_dump().items() if v}))


@router.get("/summary/")
async def summary(
    _user_id: CurrentUserId,
    months: int = Query(6, ge=1, le=24),
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    return await svc.summary(months_back=months)


@router.get("/stats/", response_model=SalesStats)
async def stats(
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    return await svc.stats()


# ── Documents ─────────────────────────────────────────────────────────────
@router.get("/{kind}/", response_model=list[DocumentSummary])
async def list_documents(
    kind: str,
    response: Response,
    _user_id: CurrentUserId,
    status_filter: str | None = None,  # legacy name
    status_csv: str | None = Query(None, alias="status"),
    customer_id: uuid.UUID | None = None,
    q: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    overdue: bool | None = None,
    sort: str = "-doc_date",
    limit: int = Query(200, ge=1, le=1000),
    offset: int = Query(0, ge=0),
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    statuses = [s.strip() for s in (status_csv or status_filter or "").split(",") if s.strip()]
    rows, total = await _call(
        svc.query_documents(
            _kind(kind),
            statuses=statuses,
            customer_id=customer_id,
            q=q,
            date_from=date_from,
            date_to=date_to,
            overdue=overdue,
            sort=sort,
            limit=limit,
            offset=offset,
        )
    )
    response.headers["X-Total-Count"] = str(total)
    return rows


@router.post("/{kind}/bulk/", response_model=BulkResponse)
async def bulk_documents(
    kind: str,
    body: BulkRequest,
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    return await _call(svc.bulk(_kind(kind), body.action, body.ids))


@router.post("/{kind}/", response_model=DocumentResponse, status_code=201)
async def create_document(
    kind: str,
    body: DocumentCreate,
    user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    data = body.model_dump(exclude={"lines"})
    return await _call(svc.create(_kind(kind), lines=_lines(body.lines), created_by=user_id, **data))


@router.get("/{kind}/{doc_id}/", response_model=DocumentResponse)
async def get_document(
    kind: str,
    doc_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    return await _call(svc.get(doc_id, _kind(kind)))


@router.patch("/{kind}/{doc_id}/", response_model=DocumentResponse)
async def update_document(
    kind: str,
    doc_id: uuid.UUID,
    body: DocumentUpdate,
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    await _call(svc.get(doc_id, _kind(kind)))
    data = body.model_dump(exclude_unset=True, exclude={"lines"})
    if body.lines is not None:
        data["lines"] = _lines(body.lines)
    return await _call(svc.update(doc_id, **data))


@router.delete("/{kind}/{doc_id}/", status_code=204)
async def delete_document(
    kind: str,
    doc_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    await _call(svc.get(doc_id, _kind(kind)))
    await _call(svc.delete(doc_id))
    return Response(status_code=204)


# Invoice transitions touch the ledger, so they need sales.post; declared before the generic route.
@router.post("/invoices/{doc_id}/status/", response_model=DocumentResponse)
async def set_invoice_status(
    doc_id: uuid.UUID,
    body: StatusRequest,
    user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.post")),
):
    await _call(svc.get(doc_id, "invoice"))
    return await _call(svc.set_status(doc_id, body.status, created_by=user_id))


@router.post("/{kind}/{doc_id}/status/", response_model=DocumentResponse)
async def set_status(
    kind: str,
    doc_id: uuid.UUID,
    body: StatusRequest,
    user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    await _call(svc.get(doc_id, _kind(kind)))
    return await _call(svc.set_status(doc_id, body.status, created_by=user_id))


@router.post("/quotes/{doc_id}/convert-to-order/", response_model=DocumentResponse, status_code=201)
async def convert_quote(
    doc_id: uuid.UUID,
    user_id: CurrentUserId,
    body: ConvertRequest | None = None,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    return await _call(svc.quote_to_order(doc_id, created_by=user_id, lines=_picked(body)))


@router.post("/orders/{doc_id}/convert-to-invoice/", response_model=DocumentResponse, status_code=201)
async def convert_order(
    doc_id: uuid.UUID,
    user_id: CurrentUserId,
    body: ConvertRequest | None = None,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    return await _call(svc.order_to_invoice(doc_id, created_by=user_id, lines=_picked(body)))


@router.post("/invoices/{doc_id}/issue/", response_model=DocumentResponse)
async def issue_invoice(
    doc_id: uuid.UUID,
    user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.post")),
):
    return await _call(svc.issue_invoice(doc_id, created_by=user_id))


@router.post("/invoices/{doc_id}/payments/", response_model=DocumentResponse, status_code=201)
async def record_payment(
    doc_id: uuid.UUID,
    body: PaymentCreate,
    user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.post")),
):
    return await _call(svc.record_payment(doc_id, created_by=user_id, **body.model_dump()))


@router.post("/invoices/{doc_id}/credit-note/", response_model=DocumentResponse, status_code=201)
async def credit_invoice(
    doc_id: uuid.UUID,
    user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    return await _call(svc.invoice_to_credit_note(doc_id, created_by=user_id))


# ── Printing and e-mail ───────────────────────────────────────────────────
@router.get("/invoices/{doc_id}/dunning-pdf/")
async def dunning_pdf(
    doc_id: uuid.UUID,
    _user_id: CurrentUserId,
    level: int = Query(1, ge=1, le=9),
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    doc = await _call(svc.get(doc_id, "invoice"))
    pdf = await run_in_threadpool(render_dunning, doc, docs.company_data(), level=level)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": attachment_disposition(f"dunning-{level}-{docs.filename(doc)}", inline=True),
            "Content-Language": lang(doc.language),
        },
    )


@router.get("/{kind}/{doc_id}/pdf/")
async def document_pdf(
    kind: str,
    doc_id: uuid.UUID,
    _user_id: CurrentUserId,
    session: SessionDep,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    doc = await _call(svc.get(doc_id, _kind(kind)))
    pdf = await docs.render_pdf(session, doc)
    return Response(
        pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": attachment_disposition(docs.filename(doc), inline=True),
            "Content-Language": lang(doc.language),
        },
    )


@router.get("/{kind}/{doc_id}/check/", response_model=list[InvoiceCheckIssue])
async def document_check(
    kind: str,
    doc_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    doc = await _call(svc.get(doc_id, _kind(kind)))
    return check_invoice(doc, docs.company_data())


@router.get("/{kind}/{doc_id}/email-draft/", response_model=EmailDraft)
async def document_email_draft(
    kind: str,
    doc_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    doc = await _call(svc.get(doc_id, _kind(kind)))
    return docs.email_draft(doc, docs.company_data())


def _email_service() -> EmailService:
    from app.core.mail_settings import mail_service

    return mail_service()


@router.post("/{kind}/{doc_id}/send/", response_model=SendLogResponse, status_code=201)
async def document_send(
    kind: str,
    doc_id: uuid.UUID,
    body: SendRequest,
    user_id: CurrentUserId,
    session: SessionDep,
    svc: SalesService = Depends(_svc),
    email: EmailService = Depends(_email_service),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    doc = await _call(svc.get(doc_id, _kind(kind)))
    try:
        return await docs.send_document(
            session, doc, to=body.to, cc=body.cc, subject=body.subject, body=body.body, sent_by=user_id, email=email
        )
    except docs.SendRefusedError as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, str(exc)) from exc


@router.get("/{kind}/{doc_id}/sends/", response_model=list[SendLogResponse])
async def document_sends(
    kind: str,
    doc_id: uuid.UUID,
    _user_id: CurrentUserId,
    session: SessionDep,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    doc = await _call(svc.get(doc_id, _kind(kind)))
    return await docs.send_history(session, doc)


# ── Duplicate, activity, related ──────────────────────────────────────────
@router.post("/{kind}/{doc_id}/duplicate/", response_model=DocumentResponse, status_code=201)
async def duplicate_document(
    kind: str,
    doc_id: uuid.UUID,
    user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    return await _call(svc.duplicate(doc_id, _kind(kind), created_by=user_id))


@router.get("/{kind}/{doc_id}/activity/", response_model=list[ActivityEvent])
async def document_activity(
    kind: str,
    doc_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    return await _call(svc.activity(doc_id, _kind(kind)))


@router.get("/{kind}/{doc_id}/related/", response_model=RelatedResponse)
async def document_related(
    kind: str,
    doc_id: uuid.UUID,
    _user_id: CurrentUserId,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.read")),
):
    return await _call(svc.related(doc_id, _kind(kind)))


# ── Online payment links (Stripe / Mollie) ───────────────────────────────
class PaymentLinkResponse(BaseModel):
    provider: str
    url: str
    amount: Decimal
    currency: str
    status: str


@router.post("/invoices/{doc_id}/payment-link/", response_model=PaymentLinkResponse, status_code=201)
async def create_payment_link(
    doc_id: uuid.UUID,
    _user_id: CurrentUserId,
    session: SessionDep,
    svc: SalesService = Depends(_svc),
    _perm: None = Depends(RequirePermission("sales.write")),
):
    from app.modules.sales import online_payments as op

    doc = await _call(svc.get(doc_id, "invoice"))
    try:
        link = await op.ensure_link(session, doc)
    except op.PaymentProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    if link is None:
        raise HTTPException(status.HTTP_409_CONFLICT, "No payment provider configured or nothing is due")
    return link


@router.post("/payment-webhooks/stripe/")
async def stripe_webhook(request: Request, session: SessionDep):
    """Unauthenticated by design; trust comes from the Stripe-Signature HMAC."""
    from app.core.payment_settings import secrets
    from app.modules.sales import online_payments as op

    cfg = secrets()
    if not cfg["stripe_webhook_secret"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Stripe is not configured")
    prov = op.StripeProvider(cfg)
    try:
        event = prov.verify(await request.body(), request.headers.get("stripe-signature", ""))
    except op.WebhookRejectedError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(exc)) from exc
    paid = op.StripeProvider.payment_from_event(event)
    outcome = "ignored" if paid is None else await op.settle(session, "stripe", paid)
    return {"received": True, "outcome": outcome}


@router.post("/payment-webhooks/mollie/")
async def mollie_webhook(request: Request, session: SessionDep):
    """Mollie posts only ``id``; the state is fetched from Mollie with our key, so a forged id proves nothing."""
    from app.core.payment_settings import secrets
    from app.modules.sales import online_payments as op

    cfg = secrets()
    if not cfg["mollie_api_key"]:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mollie is not configured")
    form = await request.form()
    payment_id = str(form.get("id") or "")
    if not payment_id.startswith("tr_") or len(payment_id) > 64 or not payment_id[3:].isalnum():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Unknown payment id")
    try:
        paid = await op.MollieProvider(cfg).fetch(payment_id)
    except op.PaymentProviderError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc
    if paid.provider_ref != payment_id:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Payment id mismatch")
    return {"received": True, "outcome": await op.settle(session, "mollie", paid)}
