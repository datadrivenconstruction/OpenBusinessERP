"""Data import: parsing (encodings, German numbers/dates), mapping, every target, dedupe, undo, tenant isolation."""

from __future__ import annotations

import io
import uuid
from datetime import date
from decimal import Decimal

import pytest
import pytest_asyncio
from sqlalchemy import select

from app.modules.contacts.models import Contact
from app.modules.data_import import parsing
from app.modules.data_import.service import DataImportService, ImportInvalid, ImportNotFound
from app.modules.gl.models import GLJournalEntry
from app.modules.gl.service import GLService
from app.modules.items.models import Item
from app.modules.items.service import ItemsService
from app.modules.sales.models import SalesDocument
from tests._pg import transactional_session

D = Decimal
T1, T2 = str(uuid.uuid4()), str(uuid.uuid4())


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


@pytest_asyncio.fixture
async def svc(session):
    return DataImportService(session, T1)


async def _run(svc, target, text, enc="utf-8", options=None, name="f.csv"):
    raw = text.encode(enc) if isinstance(text, str) else text
    job = await svc.create_job(target, name, raw)
    res = await svc.validate(job.id, job.mapping, options or {})
    return job, res


async def _contacts(session, tenant=T1):
    return list((await session.execute(select(Contact).where(Contact.tenant_id == tenant))).scalars())


# ── parsing ───────────────────────────────────────────────────────────────
def test_decode_and_delimiter():
    text = "Kundennummer;Name;Straße\n1;Müller GmbH;Hauptstraße 1\n"
    for enc, label in (("utf-8", "utf-8"), ("cp1252", "windows-1252")):
        t = parsing.parse_csv(text.encode(enc))
        assert t.encoding == label and t.delimiter == ";" and t.rows[0][1] == "Müller GmbH"
    t = parsing.parse_csv(b"\xef\xbb\xbf" + text.encode())
    assert t.encoding == "utf-8-sig" and t.headers[0] == "Kundennummer"


def test_header_row_detection_skips_title():
    t = parsing.parse_csv(b"Export 2025;;\n;;\nSKU;Name;Price\nA-1;Bolt;1,50\n")
    assert t.headers == ["SKU", "Name", "Price"] and t.rows == [["A-1", "Bolt", "1,50"]]
    assert t.header_row == 1  # blank line dropped, title row skipped


def test_numbers_and_dates():
    assert parsing.parse_decimal("1.234,56") == D("1234.56")
    assert parsing.parse_decimal("1,234.56") == D("1234.56")
    assert parsing.parse_decimal("12,5") == D("12.5")
    assert parsing.parse_decimal("(1.000,00)") == D("-1000.00")
    assert parsing.parse_decimal("100,00-") == D("-100.00")
    assert parsing.parse_decimal("€ 1 000,10") == D("1000.10")
    with pytest.raises(ValueError):
        parsing.parse_decimal("abc")
    assert parsing.parse_date("31.12.2025") == date(2025, 12, 31)
    assert parsing.parse_date("1.2.26") == date(2026, 2, 1)
    assert parsing.parse_date("2025-12-31") == date(2025, 12, 31)
    with pytest.raises(ValueError):
        parsing.parse_date("31.13.2025")


def test_vat_and_auto_map():
    assert parsing.is_valid_vat("DE 123 456 789") and not parsing.is_valid_vat("DE12345")
    m = DataImportService.suggest_mapping(
        "customers", ["Kundennummer", "Firmenname", "E-Mail-Adresse", "USt-IdNr.", "PLZ", "Foo"]
    )
    assert m == {"Kundennummer": "customer_number", "Firmenname": "name", "E-Mail-Adresse": "email",
                 "USt-IdNr.": "vat_number", "PLZ": "postal_code"}


# ── customers / suppliers ─────────────────────────────────────────────────
CUSTOMERS = (
    "Kundennummer;Name;E-Mail;USt-IdNr;Zahlungsziel\n"
    "10001;Müller GmbH;info@mueller.de;DE123456789;14\n"
    "10002;Schmidt KG;bad-email;DE123;30\n"
    "10003;Weber AG;weber@example.com;;\n"
)


async def test_customers_validate_commit_dedupe_undo(session, svc):
    job, res = await _run(svc, "customers", CUSTOMERS, "cp1252")
    s = res["summary"]
    assert (s["create"], s["error"]) == (2, 1)
    msgs = [e["message"] for e in res["errors"]]
    assert any("E-mail" in m for m in msgs) and any("VAT" in m for m in msgs)
    assert all(e["row"] == 3 for e in res["errors"])
    with pytest.raises(ImportInvalid):
        await svc.commit(job.id, job.mapping)
    out = await svc.commit(job.id, job.mapping, {"skip_invalid": True})
    assert out["summary"]["create"] == 2
    rows = await _contacts(session)
    assert {c.company_name for c in rows} == {"Müller GmbH", "Weber AG"}
    assert all(c.contact_type == "customer" for c in rows)

    # second import: same customer number -> update; unknown -> create
    job2, res2 = await _run(svc, "customers", "Kundennummer;Name;E-Mail\n10001;Müller GmbH & Co;new@m.de\n;Neu;n@x.de\n")
    assert (res2["summary"]["update"], res2["summary"]["create"]) == (1, 1)
    await svc.commit(job2.id, job2.mapping)
    m = (await session.execute(select(Contact).where(Contact.vat_number == "DE123456789"))).scalar_one()
    assert m.company_name == "Müller GmbH & Co" and m.primary_email == "new@m.de"

    assert await svc.undo(job2.id) == {"removed": 1, "kept_updates": 1}
    assert {c.company_name for c in await _contacts(session)} == {"Müller GmbH & Co", "Weber AG"}
    with pytest.raises(ImportInvalid):
        await svc.undo(job2.id)


async def test_dedupe_by_email_and_vat(session, svc):
    job, _ = await _run(svc, "customers", "Name;E-Mail;USt-IdNr\nA;a@x.de;\nB;;DE111111111\n")
    await svc.commit(job.id, job.mapping)
    _, res = await _run(svc, "customers", "Name;E-Mail;USt-IdNr\nA2;A@X.DE;\nB2;;DE 111 111 111\nB3;;DE111111111\n")
    assert (res["summary"]["update"], res["summary"]["skip"]) == (2, 1)


async def test_suppliers_and_tenant_isolation(session, svc):
    job, _ = await _run(svc, "suppliers", "Lieferantennummer,Name,Email\n70001,Holz AG,h@holz.de\n")
    await svc.commit(job.id, job.mapping)
    other = DataImportService(session, T2)
    with pytest.raises(ImportNotFound):
        await other.get_job(job.id)
    _, res = await _run(other, "suppliers", "Lieferantennummer,Name,Email\n70001,Holz AG,h@holz.de\n")
    assert res["summary"]["create"] == 1  # T1's supplier is invisible to T2
    assert [c.contact_type for c in await _contacts(session)] == ["supplier"]
    assert len(await other.list_jobs()) == 1


# ── items ─────────────────────────────────────────────────────────────────
async def test_items_upsert_by_sku_and_german_prices(session, svc):
    await ItemsService(session, T1).create_item(sku="A-1", name="Old", sales_price=D("1"))
    csv = ("Artikelnummer;Bezeichnung;Verkaufspreis;Typ\n"
           "A-1;Schraube;1.234,50;Ware\nB-2;Montage;80,00;Dienstleistung\nC-3;X;abc;Ware\n")
    job, res = await _run(svc, "items", csv)
    assert (res["summary"]["update"], res["summary"]["create"], res["summary"]["error"]) == (1, 1, 1)
    await svc.commit(job.id, job.mapping, {"skip_invalid": True})
    items = {i.sku: i for i in (await session.execute(select(Item).where(Item.tenant_id == T1))).scalars()}
    assert items["A-1"].sales_price == D("1234.50") and items["A-1"].name == "Schraube"
    assert items["B-2"].item_type == "service"
    await svc.undo(job.id)
    skus = {i.sku for i in (await session.execute(select(Item).where(Item.tenant_id == T1))).scalars()}
    assert skus == {"A-1"}


async def test_xlsx_upload(svc):
    from openpyxl import Workbook

    wb = Workbook()
    ws = wb.active
    ws.append(["SKU", "Name", "Sales price"])
    ws.append(["X-1", "Widget", 12.5])
    buf = io.BytesIO()
    wb.save(buf)
    job, res = await _run(svc, "items", buf.getvalue(), name="items.xlsx")
    assert job.encoding == "xlsx" and res["summary"]["create"] == 1


# ── opening balances ──────────────────────────────────────────────────────
async def _gl(session):
    gl = GLService(session, T1)
    await gl.load_template("de_skr03")
    await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
    accs = [a.code for a in await gl.list_accounts() if a.is_postable]
    return accs[0], accs[1], accs[2]


async def test_opening_balances_balanced_and_undo(session, svc):
    a, b, c = await _gl(session)
    csv = f"Konto;Soll;Haben\n{a};10.000,00;0\n{b};0;7.500,00\n{c};;2.500,00\n{a};500,00;\n{b};;500,00\n"
    opts = {"opening_date": "01.01.2026"}
    job, res = await _run(svc, "opening_balances", csv, options=opts)
    assert res["summary"]["ok"], res
    await svc.commit(job.id, job.mapping, opts)
    entry = (await session.execute(select(GLJournalEntry).where(
        GLJournalEntry.tenant_id == T1, GLJournalEntry.source_type == "data_import:opening"))).scalar_one()
    assert entry.status == "posted" and len(entry.lines) == 3
    assert sum(ln.debit for ln in entry.lines) == D("10500.00")
    _, res2 = await _run(svc, "opening_balances", csv, options=opts)
    assert any("already imported" in e for e in res2["summary"]["file_errors"])
    await svc.undo(job.id)
    await session.refresh(entry)
    assert entry.reversed_by_id is not None


async def test_opening_balances_unbalanced_rejected(session, svc):
    a, b, _ = await _gl(session)
    opts = {"opening_date": "2026-01-01"}
    job, res = await _run(svc, "opening_balances", f"Konto;Saldo\n{a};1.000,00\n{b};-999,00\n", options=opts)
    assert any("not balanced" in e for e in res["summary"]["file_errors"])
    with pytest.raises(ImportInvalid, match="not balanced"):
        await svc.commit(job.id, job.mapping, opts)
    assert (await session.execute(select(GLJournalEntry).where(GLJournalEntry.tenant_id == T1))).first() is None


# ── open invoices ─────────────────────────────────────────────────────────
async def test_open_invoices(session, svc):
    jc, _ = await _run(svc, "customers", "Kundennummer;Name\n10001;Müller GmbH\n")
    await svc.commit(jc.id, jc.mapping)
    csv = ("Rechnungsnummer;Kunde;Rechnungsdatum;Fällig;Brutto;Bezahlt\n"
           "RE-1;Müller GmbH;15.12.2025;14.01.2026;1.190,00;190,00\n"
           "RE-2;Unbekannt;16.12.2025;;500,00;500,00\n"
           "RE-3;Müller GmbH;32.12.2025;;100,00;\n")
    job, res = await _run(svc, "open_invoices", csv)
    assert (res["summary"]["create"], res["summary"]["skip"], res["summary"]["error"]) == (1, 1, 1)
    await svc.commit(job.id, job.mapping, {"skip_invalid": True})
    inv = (await session.execute(select(SalesDocument).where(SalesDocument.tenant_id == T1))).scalar_one()
    assert inv.number == "RE-1" and inv.status == "partially_paid" and inv.customer_id is not None
    assert inv.gross_total == D("1190.00") and inv.due_date == date(2026, 1, 14)
    _, again = await _run(svc, "open_invoices", csv)
    assert again["summary"]["create"] == 0  # deduped by number
    await svc.undo(job.id)
    assert (await session.execute(select(SalesDocument).where(SalesDocument.tenant_id == T1))).first() is None


def test_auto_map_scored_confidence():
    scored = parsing.auto_map_scored(["Firmenname", "E-Mail", "Telefonnr"], {"name": ["Firmenname"], "email": ["email"], "phone": ["telefon"]})
    assert scored["Firmenname"] == ("name", 1.0)
    assert scored["E-Mail"][1] == 1.0
    assert 0.82 <= scored["Telefonnr"][1] < 1.0


async def test_job_stores_confidence_and_existing_skip(session, svc):
    job, _ = await _run(svc, "customers", "Kundennummer;Name\n10001;Alt GmbH\n")
    assert job.summary["confidence"]["Name"] == 1.0
    await svc.commit(job.id, job.mapping)
    job2, res = await _run(svc, "customers", "Kundennummer;Name\n10001;Alt GmbH 2\n20002;Neu AG\n", options={"existing": "skip"})
    assert (res["summary"]["skip"], res["summary"]["create"], res["summary"]["update"]) == (1, 1, 0)
    await svc.commit(job2.id, job2.mapping, {"existing": "skip"})
    assert {c.company_name for c in await _contacts(session)} == {"Alt GmbH", "Neu AG"}


async def test_items_existing_skip(svc):
    job, _ = await _run(svc, "items", "SKU;Name\nA1;Eins\n")
    await svc.commit(job.id, job.mapping)
    _, res = await _run(svc, "items", "SKU;Name\nA1;Eins neu\nA2;Zwei\n", options={"existing": "skip"})
    assert (res["summary"]["skip"], res["summary"]["create"]) == (1, 1)
