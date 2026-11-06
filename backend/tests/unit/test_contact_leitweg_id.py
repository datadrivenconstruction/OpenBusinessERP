"""Default Leitweg-ID on the contact: prefill on new sales documents and e-invoice fallback."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import httpx
import pytest
import pytest_asyncio
from pydantic import ValidationError

from app.dependencies import get_current_company_tenant_id, get_current_user_payload, get_session
from app.modules.contacts.models import Contact
from app.modules.contacts.schemas import ContactCreate, ContactUpdate
from app.modules.finance.einvoice_settings_models import DEFAULT_SCOPE, EInvoiceSettings
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.sales.service import LineData, SalesService
from tests._pg import transactional_session

D = Decimal
T1 = "tenant-xr-a"
LW = "04011000-1234512345-35"


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


@pytest_asyncio.fixture
async def svc(session):
    gl = GLService(session, T1)
    await gl.load_template("de_skr03")
    await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
    session.add(
        EInvoiceSettings(
            scope=DEFAULT_SCOPE,
            seller_name="Muster Bau GmbH",
            seller_vat_id="DE811907980",
            seller_country_code="DE",
            seller_line1="Werftstrasse 4",
            seller_postcode="20457",
            seller_city="Hamburg",
            seller_contact_name="Anke Reimann",
            seller_contact_phone="+49 40 1234560",
            seller_contact_email="rechnung@muster-bau.example",
            seller_email="rechnung@muster-bau.example",
            payee_iban="DE89370400440532013000",
        )
    )
    await session.flush()
    return SalesService(session, T1)


@pytest_asyncio.fixture
async def client(session, svc):
    from fastapi import FastAPI

    from app.modules.sales.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api/v1/sales")

    async def _session():
        yield session

    async def _payload():
        return {"sub": "u1", "role": "admin"}

    async def _tenant():
        return T1

    app.dependency_overrides[get_session] = _session
    app.dependency_overrides[get_current_user_payload] = _payload
    app.dependency_overrides[get_current_company_tenant_id] = _tenant
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://t") as c:
        yield c


async def _buyer(session, leitweg_id=LW) -> Contact:
    c = Contact(
        contact_type="client",
        company_name="Stadt Hamburg",
        country_code="DE",
        address={"text": "Rathausmarkt 1", "postcode": "20095", "city": "Hamburg"},
        leitweg_id=leitweg_id,
        is_active=True,
    )
    session.add(c)
    await session.flush()
    return c


LINES = [LineData("Rohbau", "S1", D(10), D("100"), D(0), D(19))]


@pytest.mark.parametrize("kind", ["quote", "order", "invoice"])
async def test_new_document_takes_the_contact_leitweg_id(svc, session, kind):
    buyer = await _buyer(session)
    doc = await svc.create(kind, lines=LINES, customer_id=buyer.id, customer_name="Stadt Hamburg")
    assert doc.buyer_reference == LW


async def test_typed_reference_wins_over_the_contact_default(svc, session):
    buyer = await _buyer(session)
    doc = await svc.create("invoice", lines=LINES, customer_id=buyer.id, buyer_reference="PO-4711")
    assert doc.buyer_reference == "PO-4711"


async def test_contact_without_default_leaves_the_reference_empty(svc, session):
    buyer = await _buyer(session, leitweg_id=None)
    doc = await svc.create("invoice", lines=LINES, customer_id=buyer.id)
    assert doc.buyer_reference == ""


async def test_einvoice_falls_back_to_the_contact_value(client, svc, session):
    buyer = await _buyer(session)
    doc = await svc.create(
        "invoice",
        lines=LINES,
        doc_date=date(2026, 3, 10),
        due_date=date(2026, 4, 9),
        customer_id=buyer.id,
        customer_name="Stadt Hamburg",
        customer_vat_id="DE123456789",
    )
    await svc.issue_invoice(doc.id)
    doc.buyer_reference = ""  # issued before the contact had a default
    await session.flush()
    r = await client.get(f"/api/v1/sales/invoices/{doc.id}/einvoice")
    assert r.status_code == 200 and LW in r.text


def test_contact_schema_normalises_and_rejects():
    assert ContactCreate(contact_type="client", leitweg_id=" 991-01234-44 ").leitweg_id == "991-01234-44"
    assert ContactUpdate(leitweg_id="").leitweg_id is None
    with pytest.raises(ValidationError):
        ContactCreate(contact_type="client", leitweg_id="DE123456789")
