"""Sales document printing: PDFs per kind, invoice data check, GiroCode, e-mail send log."""

from __future__ import annotations

import io
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from pypdf import PdfReader

from app.core.email.memory import MemoryEmailBackend
from app.core.email.service import EmailService
from app.modules.sales.documents import service as docs
from app.modules.sales.documents.checks import check_invoice
from app.modules.sales.documents.girocode import GiroCodeError, epc_payload
from app.modules.sales.documents.i18n import fmt_money
from app.modules.sales.service import LineData, SalesNotFoundError, SalesService
from tests._pg import transactional_session

D = Decimal
IBAN = "DE89370400440532013000"
COMPANY = {
    "company_name": "Muster Bau GmbH",
    "address": "Hauptstr. 1\n10115 Berlin",
    "vat_id": "DE123456789",
    "tax_number": "",
    "iban": IBAN,
    "bic": "COBADEFFXXX",
    "giro_code": True,
    "payment_terms_days": 14,
    "document_texts": {},
    "logo_data_url": "",
}


@pytest.fixture(autouse=True)
def _company(monkeypatch):
    monkeypatch.setattr(docs, "read_business_settings", lambda: dict(COMPANY))
    monkeypatch.setattr(docs, "read_company_profile", lambda: {})


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


async def _doc(session, kind="invoice", tenant="t-a", **extra):
    svc = SalesService(session, tenant)
    lines = [
        LineData("Planning work", "SVC-1", D("3"), D("100"), D("0"), D("19")),
        LineData("Handbook", "", D("2"), D("10"), D("0"), D("7")),
    ]
    data = {
        "customer_name": "Kunde AG",
        "customer_address": "Ringweg 5\n80331 München",
        "customer_email": "buyer@example.com",
        "delivery_date": date(2026, 3, 1),
        "language": "de",
    }
    data.update(extra)
    return await svc.create(kind, lines=lines, doc_date=date(2026, 3, 10), **data)


@pytest.mark.asyncio
@pytest.mark.parametrize("kind", ["quote", "order", "invoice", "credit_note"])
@pytest.mark.parametrize("language", ["de", "en", "ru", "pl"])
async def test_pdf_renders_each_kind(session, kind, language):
    doc = await _doc(session, kind, language=language)
    pdf = await docs.render_pdf(session, doc)
    assert pdf.startswith(b"%PDF")
    text = "".join(page.extract_text() for page in PdfReader(io.BytesIO(pdf)).pages)
    assert doc.number in text


@pytest.mark.asyncio
async def test_check_complete_and_missing(session):
    doc = await _doc(session)
    assert check_invoice(doc, COMPANY) == []
    bare = await _doc(session, customer_address="", delivery_date=None)
    fields = {i["field"] for i in check_invoice(bare, {**COMPANY, "vat_id": "", "address": ""})}
    assert {"customer_address", "delivery_date", "tax_id", "company_address"} <= fields
    zero = await _doc(session)
    zero.lines[0].tax_rate = D(0)
    assert "tax_note" in {i["field"] for i in check_invoice(zero, COMPANY)}
    quote = await _doc(session, "quote", customer_address="")
    assert check_invoice(quote, COMPANY) == []


def test_girocode_payload():
    payload = epc_payload(
        name="Muster Bau GmbH",
        iban="DE89 3704 0044 0532 0130 00",
        bic="COBADEFFXXX",
        amount=D("341.40"),
        remittance="INV-000001",
    )
    assert payload.split("\n") == [
        "BCD",
        "002",
        "1",
        "SCT",
        "COBADEFFXXX",
        "Muster Bau GmbH",
        IBAN,
        "EUR341.40",
        "",
        "",
        "INV-000001",
    ]
    assert len(payload.encode()) <= 331
    short = epc_payload(name="X", iban=IBAN, amount=D(1))
    assert short.endswith("EUR1.00")
    with pytest.raises(GiroCodeError):
        epc_payload(name="X", iban="DE00370400440532013000", amount=D(1))
    with pytest.raises(GiroCodeError):
        epc_payload(name="X", iban=IBAN, amount=D(1), currency="USD")


def test_money_format():
    assert fmt_money(D("1234.5"), "EUR", "de") == "1.234,50\u00a0€"
    assert fmt_money(D("1234.5"), "USD", "en") == "$1,234.50"


@pytest.mark.asyncio
async def test_send_writes_log_and_uses_outbox(session):
    doc = await _doc(session)
    backend = MemoryEmailBackend()
    draft = docs.email_draft(doc, docs.company_data())
    assert doc.number in draft["subject"] and "{" not in draft["body"]
    log = await docs.send_document(
        session,
        doc,
        to="buyer@example.com",
        cc=["acc@example.com"],
        subject=draft["subject"],
        body=draft["body"],
        sent_by="user-1",
        email=EmailService(backend),
    )
    assert log.status == "sent" and log.to_addr == "buyer@example.com" and log.cc == ["acc@example.com"]
    assert len(backend.sent) == 1 and backend.sent[0].cc == ["acc@example.com"]
    assert doc.sent_to == "buyer@example.com" and doc.sent_at is not None
    assert backend.sent[0].attachments[0].content.startswith(b"%PDF")
    history = await docs.send_history(session, doc)
    assert [h.id for h in history] == [log.id] and history[0].sent_by == "user-1"


@pytest.mark.asyncio
async def test_demo_address_refused(session):
    doc = await _doc(session)
    backend = MemoryEmailBackend()
    with pytest.raises(docs.SendRefusedError):
        await docs.send_document(
            session,
            doc,
            to="demo@openbusinesserp.com",
            cc=[],
            subject="s",
            body="b",
            sent_by="u",
            email=EmailService(backend),
        )
    with pytest.raises(docs.SendRefusedError):
        await docs.send_document(
            session,
            doc,
            to="buyer@example.com",
            cc=["demo@openbusinesserp.com"],
            subject="s",
            body="b",
            sent_by="u",
            email=EmailService(backend),
        )
    assert backend.sent == [] and await docs.send_history(session, doc) == []


@pytest.mark.asyncio
async def test_tenant_isolation(session):
    doc = await _doc(session, tenant="t-a")
    with pytest.raises(SalesNotFoundError):
        await SalesService(session, "t-b").get(doc.id, "invoice")
    await docs.send_document(
        session,
        doc,
        to="buyer@example.com",
        cc=[],
        subject="s",
        body="b",
        sent_by="u",
        email=EmailService(MemoryEmailBackend()),
    )
    other = await _doc(session, tenant="t-b")
    assert await docs.send_history(session, other) == []


def test_epc_spec_example():
    """EPC069-12 sample (Belgian Red Cross), emitted as version 002 with a two-decimal amount."""
    payload = epc_payload(
        name="Red Cross of Belgium",
        iban="BE72000000001616",
        bic="BPOTBEB1",
        amount=D("1"),
        purpose="CHAR",
        remittance="Urgency fund",
    )
    assert payload.split("\n") == [
        "BCD", "002", "1", "SCT", "BPOTBEB1", "Red Cross of Belgium",
        "BE72000000001616", "EUR1.00", "CHAR", "", "Urgency fund",
    ]  # fmt: skip


@pytest.mark.asyncio
async def test_template_placeholders_and_aliases(session):
    doc = await _doc(session, due_date=date(2026, 3, 24))
    values = docs.placeholders(doc, COMPANY)
    text = docs.fill("{number}|{customer}|{company}|{total}|{due_date}|{unknown}", values)
    assert text == f"{doc.number}|Kunde AG|Muster Bau GmbH|{values['total']}|24.03.2026|{{unknown}}"
    assert "378,40" in values["total"]
    en = await _doc(session, language="en")
    assert "Hello" in docs.email_draft(en, COMPANY)["body"]
    assert "Guten Tag" in docs.email_draft(doc, COMPANY)["body"]
    custom = {**COMPANY, "document_texts": {"invoice": {"email_subject": "Rechnung {number} / {company}"}}}
    assert docs.email_draft(doc, custom)["subject"] == f"Rechnung {doc.number} / Muster Bau GmbH"


@pytest.mark.asyncio
async def test_quote_send_moves_to_sent_only_on_success(session):
    class Failing(MemoryEmailBackend):
        async def send(self, message):
            from app.core.email.base import DeliveryResult

            return DeliveryResult.failure("memory", "boom")

    quote = await _doc(session, "quote")
    log = await docs.send_document(
        session, quote, to="buyer@example.com", cc=[], subject="s", body="b", sent_by="u", email=EmailService(Failing())
    )
    assert log.status == "failed" and quote.status == "draft" and quote.sent_at is None
    await docs.send_document(
        session,
        quote,
        to="buyer@example.com",
        cc=[],
        subject="s",
        body="b",
        sent_by="u",
        email=EmailService(MemoryEmailBackend()),
    )
    assert quote.status == "sent"
