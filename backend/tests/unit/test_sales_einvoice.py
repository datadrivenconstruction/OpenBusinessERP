"""Sales invoice e-invoice export: validation, XML and per-line VAT category."""

from __future__ import annotations

from datetime import date
from decimal import Decimal

import httpx
import pytest
import pytest_asyncio

from app.dependencies import get_current_company_tenant_id, get_current_user_payload, get_session
from app.modules.contacts.models import Contact
from app.modules.finance.einvoice_settings_models import DEFAULT_SCOPE, EInvoiceSettings
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.sales.einvoice import line_vat_category
from app.modules.sales.service import LineData, SalesService
from tests._pg import transactional_session

D = Decimal
T1 = "tenant-xr-a"
REVERSE_NOTE = "Steuerschuldnerschaft des Leistungsempfängers gemäß § 13b UStG"


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


async def _buyer(session) -> Contact:
    c = Contact(
        contact_type="client",
        company_name="Stadt Hamburg",
        country_code="DE",
        address={"text": "Rathausmarkt 1", "postcode": "20095", "city": "Hamburg"},
        is_active=True,
    )
    session.add(c)
    await session.flush()
    return c


async def _invoice(svc, session, lines, *, issue=True, **kw):
    buyer = await _buyer(session)
    doc = await svc.create(
        "invoice",
        lines=lines,
        doc_date=date(2026, 3, 10),
        due_date=date(2026, 4, 9),
        customer_id=buyer.id,
        customer_name="Stadt Hamburg",
        customer_vat_id="DE123456789",
        **kw,
    )
    if issue:
        await svc.issue_invoice(doc.id)
    return doc


MIXED = [
    LineData("Rohbau", "S1", D(10), D("100"), D(0), D(19)),
    LineData("Fachbuch", "S2", D(2), D("25"), D(0), D(7)),
]


def test_line_vat_category():
    assert line_vat_category(D(19), "") == "S"
    assert line_vat_category(D(0), REVERSE_NOTE) == "AE"
    assert line_vat_category(D(0), "Innergemeinschaftliche Lieferung") == "K"
    assert line_vat_category(D(0), "Kleinunternehmer gemäß § 19 UStG") == "E"
    assert line_vat_category(D(0), "") == "Z"


async def test_missing_leitweg_id_is_fatal_on_xrechnung(client, svc, session):
    doc = await _invoice(svc, session, MIXED)
    r = await client.get(f"/api/v1/sales/invoices/{doc.id}/einvoice", params={"dry_run": "true"})
    assert r.status_code == 200
    body = r.json()
    assert body["valid"] is False
    assert any(v["rule_id"] == "BR-DE-15" and v["severity"] == "fatal" for v in body["violations"])


async def test_valid_xml_for_19_and_7_percent(client, svc, session):
    doc = await _invoice(svc, session, MIXED, buyer_reference="04011000-1234512345-35")
    r = await client.get(f"/api/v1/sales/invoices/{doc.id}/einvoice", params={"dry_run": "true"})
    assert r.json()["valid"] is True, r.json()["problems"]
    r = await client.get(f"/api/v1/sales/invoices/{doc.id}/einvoice")
    assert r.status_code == 200 and "xml" in r.headers["content-type"]
    xml = r.text
    assert "04011000-1234512345-35" in xml and doc.number in xml
    assert "<ram:RateApplicablePercent>19" in xml and "<ram:RateApplicablePercent>7" in xml
    assert "<ram:CategoryCode>S</ram:CategoryCode>" in xml


async def test_reverse_charge_invoice_uses_category_ae(client, svc, session):
    lines = [LineData("Subunternehmerleistung", "S1", D(1), D("1000"), D(0), D(0))]
    doc = await _invoice(svc, session, lines, tax_note=REVERSE_NOTE, buyer_reference="04011000-1234512345-35")
    r = await client.get(f"/api/v1/sales/invoices/{doc.id}/einvoice")
    assert r.status_code == 200
    assert "<ram:CategoryCode>AE</ram:CategoryCode>" in r.text
    assert "<ram:CategoryCode>S</ram:CategoryCode>" not in r.text


async def test_draft_invoice_is_refused(client, svc, session):
    doc = await _invoice(svc, session, MIXED, issue=False)
    r = await client.get(f"/api/v1/sales/invoices/{doc.id}/einvoice", params={"dry_run": "true"})
    assert r.status_code == 409
