"""Accountant exports: DATEV EXTF Buchungsstapel / Debitoren-Kreditoren and SAF-T 2.0."""

from __future__ import annotations

import xml.etree.ElementTree as ET
from datetime import date, datetime
from decimal import Decimal

from app.modules.gl import exports as gx

D = Decimal
SETTINGS = {"berater_nr": 29098, "mandant_nr": 55003, "sachkontenlaenge": 4, "skr": "03"}
NOW = datetime(2026, 3, 31, 14, 5, 9, 123000)


def _entries() -> list[gx.XEntry]:
    return [
        # Sales invoice: 1400 / 8400 net + 1776 VAT (automatic account -> no BU key)
        gx.XEntry(
            "RE-2026-001",
            date(2026, 3, 5),
            'Rechnung "Müller" GmbH',
            [
                gx.XLine("1400", debit=D("1190.00")),
                gx.XLine("8400", credit=D("1000.00")),
                gx.XLine("1776", credit=D("190.00")),
            ],
            3,
            2026,
        ),  # fmt: skip
        # Rent with input VAT on a non-automatic account -> BU 9
        gx.XEntry(
            "ER-7",
            date(2026, 3, 12),
            "Miete März",
            [
                gx.XLine("4210", debit=D("500.00")),
                gx.XLine("1576", debit=D("95.00")),
                gx.XLine("1200", credit=D("595.00")),
            ],
            3,
            2026,
        ),  # fmt: skip
        # Split 2:1 without tax
        gx.XEntry(
            "GL-3",
            date(2026, 3, 20),
            "Umbuchung",
            [
                gx.XLine("1200", debit=D("300.50")),
                gx.XLine("1000", credit=D("100.25")),
                gx.XLine("1360", credit=D("200.25")),
            ],
            3,
            2026,
        ),  # fmt: skip
    ]


def _csv() -> list[str]:
    raw = gx.datev_booking_csv(
        _entries(),
        SETTINGS,
        date_from=date(2026, 3, 1),
        date_to=date(2026, 3, 31),
        fy_start=date(2026, 1, 1),
        created=NOW,
    )
    assert raw.endswith(b"\r\n")
    return raw.decode("cp1252").split("\r\n")[:-1]


def test_datev_header_golden():
    head = _csv()[0]
    assert head == (
        '"EXTF";700;21;"Buchungsstapel";13;20260331140509123;;"OB";"OpenBusinessERP";"";29098;55003;20260101;4;'
        '20260301;20260331;"OBERP 2026-03 - 2026-03";"";1;0;0;"EUR";;"";;;"03";;;"";""'
    )
    assert len(head.split(";")) == 31


def test_datev_rows_golden():
    lines = _csv()
    assert lines[1].split(";")[:3] == ["Umsatz (ohne Soll/Haben-Kz)", "Soll/Haben-Kennzeichen", "WKZ Umsatz"]
    assert lines[2:] == [
        '1190,00;"S";"EUR";;;"";1400;8400;"";0503;"RE-2026-001";"";;"Rechnung ""Müller"" GmbH"',
        '595,00;"H";"EUR";;;"";1200;4210;"9";1203;"ER-7";"";;"Miete März"',
        '100,25;"S";"EUR";;;"";1200;1000;"";2003;"GL-3";"";;"Umbuchung"',
        '200,25;"S";"EUR";;;"";1200;1360;"";2003;"GL-3";"";;"Umbuchung"',
    ]


def test_datev_encoding_is_cp1252():
    raw = gx.datev_booking_csv(
        _entries(),
        SETTINGS,
        date_from=date(2026, 3, 1),
        date_to=date(2026, 3, 31),
        fy_start=date(2026, 1, 1),
        created=NOW,
    )
    assert "Müller".encode("cp1252") in raw and "Müller".encode() not in raw


def test_datev_row_totals_equal_journal_after_tax_fold():
    # Gross per entry: DATEV row total equals the gross debit total
    assert [sum(r.amount for r in gx.datev_rows(e)) for e in _entries()] == [D("1190.00"), D("595.00"), D("300.50")]


def test_unmatched_tax_stays_as_row():
    e = gx.XEntry("X", date(2026, 1, 2), "Korrektur", [gx.XLine("1776", debit=D("5")), gx.XLine("1200", credit=D("5"))])
    rows = gx.datev_rows(e)
    assert [(r.konto, r.gegenkonto, r.bu) for r in rows] == [("1776", "1200", "")]


def test_contacts_csv():
    cs = gx.assign_contact_numbers(
        [
            gx.XContact("b", "supplier", "Lieferant AG", vat="DE123456789", country="DE", city="Köln"),
            gx.XContact("a", "customer", "Kunde GmbH", street="Hauptstr. 1", zip="10115", city="Berlin"),
        ],
        4,
    )
    assert {c.kind: c.number for c in cs} == {"customer": 10000, "supplier": 70000}
    lines = gx.datev_contacts_csv(cs, SETTINGS, fy_start=date(2026, 1, 1), created=NOW).decode("cp1252").split("\r\n")
    assert lines[0].startswith('"EXTF";700;16;"Debitoren/Kreditoren";5;')
    assert lines[2].startswith('10000;"Kunde GmbH"')
    assert '"DE";"123456789"' in lines[3] and '"Köln"' in lines[3]


def test_settings_roundtrip(tmp_path):
    assert gx.read_export_settings(tmp_path)["sachkontenlaenge"] == 4
    out = gx.write_export_settings({"berater_nr": 12345, "sachkontenlaenge": 99, "mandant_nr": "7"}, tmp_path)
    assert out == {"berater_nr": 12345, "mandant_nr": 7, "sachkontenlaenge": 4, "skr": "03"}


def test_saft_structure_and_totals():
    ns = {"s": gx.SAFT_NS}
    xml = gx.saft_xml(
        company=gx.XCompany(name="Demo GmbH", vat="DE999", country="DE"),
        accounts=[gx.XAccount("1200", "Bank", "asset", D("10"), D("-5")), gx.XAccount("8400", "Erlöse", "income")],
        contacts=[gx.XContact("c1", "customer", "Kunde GmbH")],
        entries=_entries(),
        tax_rates=[("VAT1", "Standard", D("19"))],
        date_from=date(2026, 3, 1),
        date_to=date(2026, 3, 31),
        created=NOW,
        receivable_account="1400",
    )
    root = ET.fromstring(xml)
    assert root.tag == f"{{{gx.SAFT_NS}}}AuditFile"
    assert [c.tag.split("}")[1] for c in root] == ["Header", "MasterFiles", "GeneralLedgerEntries"]
    assert root.findtext("s:Header/s:AuditFileVersion", namespaces=ns) == "2.00"
    acc = root.find("s:MasterFiles/s:GeneralLedgerAccounts/s:Account", ns)
    assert acc.findtext("s:OpeningDebitBalance", namespaces=ns) == "10.00"
    assert acc.findtext("s:ClosingCreditBalance", namespaces=ns) == "5.00"
    assert root.findtext("s:MasterFiles/s:Customers/s:Customer/s:AccountID", namespaces=ns) == "1400"
    gle = root.find("s:GeneralLedgerEntries", ns)
    assert gle.findtext("s:NumberOfEntries", namespaces=ns) == "3"
    dr = sum(D(a.text) for a in gle.iterfind(".//s:DebitAmount/s:Amount", ns))
    cr = sum(D(a.text) for a in gle.iterfind(".//s:CreditAmount/s:Amount", ns))
    journal = sum((ln.debit for e in _entries() for ln in e.lines), D(0))
    assert (
        dr
        == cr
        == journal
        == D(gle.findtext("s:TotalDebit", namespaces=ns))
        == D(gle.findtext("s:TotalCredit", namespaces=ns))
    )


async def test_collect_matches_journal(monkeypatch):
    from app.modules.gl import service as gl_service
    from app.modules.gl.service import GLService, LineInput
    from tests._pg import transactional_session

    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})
    async with transactional_session() as s:
        svc = GLService(s)
        await svc.load_template("de_skr03")
        await svc.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
        acc = {a.code: a.id for a in await svc.list_accounts()}
        await svc.create_entry(
            entry_date=date(2026, 3, 5),
            lines=[LineInput(acc["1400"], debit=D("119")), LineInput(acc["8400"], credit=D("100")),
                   LineInput(acc["1776"], credit=D("19"))],
            post=True,
        )  # fmt: skip
        col = await gx.collect(s, svc.tenant_id, date(2026, 3, 1), date(2026, 3, 31))
        assert len(col["entries"]) == 1 and col["fy_start"] == date(2026, 1, 1)
        assert [(r.konto, r.gegenkonto, r.amount) for r in gx.datev_rows(col["entries"][0])] == [
            ("1400", "8400", D("119"))
        ]
        tb = await svc.trial_balance(date(2026, 3, 1), date(2026, 3, 31))
        assert sum(a.closing for a in col["accounts"]) == 0
        assert sum(ln.debit for ln in col["entries"][0].lines) == tb["total_debit"]
