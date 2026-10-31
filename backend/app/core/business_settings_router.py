"""Business settings API.

GET /api/v1/business-settings/ - any signed-in user.
PUT /api/v1/business-settings/ - admin only. Merge and persist.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.core.business_settings import read_business_settings, write_business_settings
from app.dependencies import CurrentCompanyTenantId, RequireRole, SessionDep, get_current_user_payload

router = APIRouter(tags=["business-settings"])


class TaxRate(BaseModel):
    name: str = Field(max_length=40)
    rate: float = Field(ge=0, le=100)
    default: bool = False


class NumberingRow(BaseModel):
    area: str
    kind: str
    prefix: str
    last_number: int
    next_number: str


class BusinessSettings(BaseModel):
    company_name: str = ""
    country_code: str = ""
    base_currency: str = ""
    fiscal_year_start_month: int = 1
    industry: str = ""
    company_size: str = ""
    address: str = ""
    email: str = ""
    phone: str = ""
    website: str = ""
    vat_id: str = ""
    tax_number: str = ""
    iban: str = ""
    bic: str = ""
    bank_name: str = ""
    register_court: str = ""
    register_number: str = ""
    managing_directors: str = ""
    footer_text: str = ""
    payment_terms_days: int = 14
    payment_terms_text: str = ""
    giro_code: bool = True
    logo_data_url: str = ""
    document_texts: dict[str, dict[str, str]] = Field(default_factory=dict)
    tax_rates: list[TaxRate] = Field(default_factory=list)


class BusinessSettingsUpdate(BaseModel):
    company_name: str | None = Field(default=None, max_length=200)
    country_code: str | None = Field(default=None, max_length=2)
    base_currency: str | None = Field(default=None, max_length=3)
    fiscal_year_start_month: int | None = Field(default=None, ge=1, le=12)
    industry: str | None = Field(default=None, max_length=50)
    company_size: str | None = Field(default=None, max_length=10)
    address: str | None = Field(default=None, max_length=400)
    email: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    website: str | None = Field(default=None, max_length=120)
    vat_id: str | None = Field(default=None, max_length=20)
    tax_number: str | None = Field(default=None, max_length=30)
    iban: str | None = Field(default=None, max_length=42)
    bic: str | None = Field(default=None, max_length=11)
    bank_name: str | None = Field(default=None, max_length=80)
    register_court: str | None = Field(default=None, max_length=80)
    register_number: str | None = Field(default=None, max_length=40)
    managing_directors: str | None = Field(default=None, max_length=160)
    footer_text: str | None = Field(default=None, max_length=300)
    payment_terms_days: int | None = Field(default=None, ge=0, le=365)
    payment_terms_text: str | None = Field(default=None, max_length=300)
    giro_code: bool | None = None
    logo_data_url: str | None = Field(default=None, max_length=700_000)
    document_texts: dict[str, dict[str, str]] | None = None
    tax_rates: list[TaxRate] | None = Field(default=None, max_length=20)


@router.get(
    "/business-settings/",
    response_model=BusinessSettings,
    dependencies=[Depends(get_current_user_payload)],
)
async def get_business_settings() -> BusinessSettings:
    return BusinessSettings(**read_business_settings())


@router.put(
    "/business-settings/",
    response_model=BusinessSettings,
    dependencies=[Depends(RequireRole("admin"))],
)
async def put_business_settings(body: BusinessSettingsUpdate) -> BusinessSettings:
    return BusinessSettings(**write_business_settings(body.model_dump()))


@router.get(
    "/business-settings/numbering/",
    response_model=list[NumberingRow],
    dependencies=[Depends(get_current_user_payload)],
)
async def get_numbering(session: SessionDep, tenant_id: CurrentCompanyTenantId = None) -> list[NumberingRow]:
    """Document numbering per area for the caller's company (read-only)."""
    if tenant_id is None:
        raise HTTPException(status_code=403, detail="No company selected")
    from app.modules.purchasing.models import PurchasingSequence
    from app.modules.purchasing.service import PREFIX as PURCHASING_PREFIX
    from app.modules.sales.models import SalesSequence
    from app.modules.sales.service import PREFIX as SALES_PREFIX

    rows: list[NumberingRow] = []
    for area, model, prefixes in (
        ("sales", SalesSequence, SALES_PREFIX),
        ("purchasing", PurchasingSequence, PURCHASING_PREFIX),
    ):
        last = {
            seq.kind: seq.last_number
            for seq in (await session.scalars(select(model).where(model.tenant_id == tenant_id))).all()
        }
        for kind, prefix in prefixes.items():
            n = last.get(kind, 0)
            rows.append(
                NumberingRow(area=area, kind=kind, prefix=prefix, last_number=n, next_number=f"{prefix}-{n + 1:06d}")
            )
    return rows


# ── Outbound mail (SMTP) ──────────────────────────────────────────────────


class MailSettings(BaseModel):
    host: str
    port: int
    security: str
    username: str
    from_name: str
    from_address: str
    reply_to: str
    password_set: bool
    configured: bool
    source: str  # env | settings | none


class MailSettingsUpdate(BaseModel):
    host: str | None = Field(default=None, max_length=253)
    port: int | None = Field(default=None, ge=1, le=65535)
    security: str | None = Field(default=None, pattern="^(starttls|ssl|none)$")
    username: str | None = Field(default=None, max_length=200)
    password: str | None = Field(default=None, max_length=500)
    from_name: str | None = Field(default=None, max_length=120)
    from_address: str | None = Field(default=None, max_length=254)
    reply_to: str | None = Field(default=None, max_length=254)


class MailStatus(BaseModel):
    configured: bool
    source: str


class MailTestRequest(BaseModel):
    to: str = Field(min_length=3, max_length=254)


class MailTestResult(BaseModel):
    ok: bool
    backend: str
    reason: str


@router.get(
    "/business-settings/mail/status/", response_model=MailStatus, dependencies=[Depends(get_current_user_payload)]
)
async def get_mail_status() -> MailStatus:
    from app.core.mail_settings import mail_status

    return MailStatus(**mail_status())


@router.get("/business-settings/mail/", response_model=MailSettings, dependencies=[Depends(RequireRole("admin"))])
async def get_mail_settings() -> MailSettings:
    from app.core.mail_settings import read_mail_settings

    return MailSettings(**read_mail_settings())


@router.put("/business-settings/mail/", response_model=MailSettings, dependencies=[Depends(RequireRole("admin"))])
async def put_mail_settings(body: MailSettingsUpdate) -> MailSettings:
    from app.core.mail_settings import write_mail_settings

    return MailSettings(**write_mail_settings(body.model_dump()))


@router.post(
    "/business-settings/mail/test/", response_model=MailTestResult, dependencies=[Depends(RequireRole("admin"))]
)
async def send_test_mail(body: MailTestRequest) -> MailTestResult:
    from app.core.email.base import EmailMessage
    from app.core.email.templates import wrap
    from app.core.mail_settings import mail_service, mail_status

    if not mail_status()["configured"]:
        raise HTTPException(status_code=409, detail="Outbound mail is not configured")
    svc = mail_service()
    result = await svc.send(
        EmailMessage(
            to=body.to.strip(),
            subject="OpenBusinessERP test e-mail",
            html_body=wrap("Test e-mail", "<p>Your outbound mail settings work.</p>"),
            tags=["mail_test"],
        )
    )
    return MailTestResult(ok=result.ok, backend=result.backend, reason=result.reason)
