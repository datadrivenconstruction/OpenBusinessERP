"""Swiss QR-bill payload, references and IBAN detection (pure unit tests)."""

from __future__ import annotations

from decimal import Decimal

import pytest

from app.modules.sales.documents import qrbill
from app.modules.sales.documents.pdf import render_document, sample_document, swiss_qr_bill_data

QR_IBAN = "CH4431999123000889012"
IBAN = "CH5800791123000889012"
CRED = qrbill.Address("Robert Schneider AG", "Rue du Lac", "1268", "2501", "Biel", "CH")
DEBT = qrbill.Address("Pia-Maria Rutschmann-Schnyder", "Grosse Marktgasse", "28", "9400", "Rorschach", "CH")


def test_iban_detection():
    assert qrbill.is_swiss_iban(IBAN) and not qrbill.is_qr_iban(IBAN)
    assert qrbill.is_qr_iban("CH44 3199 9123 0008 8901 2")
    assert not qrbill.is_swiss_iban("DE89370400440532013000")
    assert not qrbill.is_swiss_iban("CH4431999123000889013")


def test_qrr_check_digit():
    assert qrbill.qrr_check_digit("21000000000313947143000901") == "7"
    assert qrbill.qrr_valid("210000000003139471430009017")
    assert not qrbill.qrr_valid("210000000003139471430009018")
    ref = qrbill.qrr_reference("RE-2026-0042")
    assert len(ref) == 27 and ref.startswith("0" * 18) and qrbill.qrr_valid(ref)
    with pytest.raises(qrbill.QrBillError):
        qrbill.qrr_reference("ABC")


def test_scor_reference():
    assert qrbill.scor_reference("539007547034") == "RF18539007547034"
    assert qrbill.scor_valid("RF18 5390 0754 7034")
    assert not qrbill.scor_valid("RF19539007547034")
    assert qrbill.scor_valid(qrbill.scor_reference("RE-2026-0042"))


def test_payload_qrr():
    p = qrbill.qr_bill_payload(
        creditor=CRED,
        iban=QR_IBAN,
        amount=Decimal("1949.75"),
        debtor=DEBT,
        reference_type="QRR",
        reference="210000000003139471430009017",
        message="Auftrag vom 15.06.2020",
    )
    f = p.split("\r\n")
    assert f[:4] == ["SPC", "0200", "1", QR_IBAN]
    assert f[4:11] == ["S", "Robert Schneider AG", "Rue du Lac", "1268", "2501", "Biel", "CH"]
    assert f[11:18] == [""] * 7
    assert f[18:20] == ["1949.75", "CHF"]
    assert f[20] == "S" and f[26] == "CH"
    assert f[27:] == ["QRR", "210000000003139471430009017", "Auftrag vom 15.06.2020", "EPD"]
    assert len(f) == 31


def test_payload_rules():
    ok = qrbill.qr_bill_payload(creditor=CRED, iban=IBAN, amount=None, currency="EUR")
    assert ok.split("\r\n")[18:28] == ["", "EUR", *[""] * 7, "NON"]
    bad = [
        dict(iban=QR_IBAN, reference_type="NON"),
        dict(iban=IBAN, reference_type="QRR", reference="210000000003139471430009017"),
        dict(iban=QR_IBAN, reference_type="SCOR", reference="RF18539007547034"),
        dict(iban=IBAN, reference_type="NON", currency="USD"),
        dict(iban="DE89370400440532013000"),
        dict(iban=IBAN, amount=Decimal("0")),
        dict(iban=IBAN, message="x" * 141),
    ]
    for kw in bad:
        args = dict(creditor=CRED, amount=Decimal("1"), reference_type="NON") | kw
        with pytest.raises(qrbill.QrBillError):
            qrbill.qr_bill_payload(**args)
    with pytest.raises(qrbill.QrBillError):
        qrbill.qr_bill_payload(creditor=qrbill.Address("X"), iban=IBAN, amount=None)


def test_parse_address():
    a = qrbill.parse_swiss_address("Muster AG", "Bahnhofstrasse 12a\n8001 Zürich")
    assert a == qrbill.Address("Muster AG", "Bahnhofstrasse", "12a", "8001", "Zürich", "CH")
    assert qrbill.parse_swiss_address("X", "Städtle 1\n9490 Vaduz").country == "LI"
    assert qrbill.parse_swiss_address("X", "Hauptstr. 1\n10115 Berlin") is None


def test_only_for_swiss_business():
    co = {
        "company_name": "Muster AG",
        "address": "Bahnhofstrasse 1\n8001 Zürich",
        "iban": IBAN,
        "country_code": "CH",
        "giro_code": True,
    }
    data = swiss_qr_bill_data(co, currency="CHF", amount=Decimal("10"), reference="RE-1")
    assert data and data[1]["ref_type"] == "SCOR"
    assert (
        swiss_qr_bill_data(co | {"country_code": "DE"}, currency="CHF", amount=Decimal("10"), reference="RE-1") is None
    )
    assert swiss_qr_bill_data(co | {"giro_code": False}, currency="CHF", amount=Decimal("10"), reference="R") is None
    qr = swiss_qr_bill_data(co | {"iban": QR_IBAN}, currency="CHF", amount=Decimal("10"), reference="RE-2026-7")
    assert qr and qr[1]["ref_type"] == "QRR"


def test_pdf_renders_payment_part():
    doc = sample_document("invoice", "de", 2, "CHF")
    co = {
        "company_name": "Muster AG",
        "address": "Bahnhofstrasse 1\n8001 Zürich",
        "iban": QR_IBAN,
        "country_code": "CH",
        "giro_code": True,
        "document_texts": {},
        "logo_data_url": "",
    }
    assert render_document(doc, co).startswith(b"%PDF")


def _pages(pdf: bytes) -> list[str]:
    import io

    from pypdf import PdfReader

    return [p.extract_text() for p in PdfReader(io.BytesIO(pdf)).pages]


CO = {
    "company_name": "Muster AG",
    "address": "Bahnhofstrasse 1\n8001 Zürich",
    "iban": QR_IBAN,
    "country_code": "CH",
    "giro_code": True,
    "document_texts": {},
    "logo_data_url": "",
}


@pytest.mark.parametrize(
    ("lg", "receipt", "part", "account"),
    [
        ("de", "Empfangsschein", "Zahlteil", "Konto / Zahlbar an"),
        ("fr", "Récépissé", "Section paiement", "Compte / Payable à"),
        ("it", "Ricevuta", "Sezione pagamento", "Conto / Pagabile a"),
        ("en", "Receipt", "Payment part", "Account / Payable to"),
    ],
)
def test_slip_labels_follow_language(lg, receipt, part, account):
    last = _pages(render_document(sample_document("invoice", lg, 2, "CHF"), CO, language=lg))[-1]
    for label in (receipt, part, account):
        assert label in last


def test_slip_moves_to_a_new_page_when_space_is_short():
    grew = False
    for n in range(1, 25):
        doc = sample_document("invoice", "de", n, "CHF")
        plain = _pages(render_document(doc, CO | {"giro_code": False}))
        swiss = _pages(render_document(doc, CO))
        assert "Empfangsschein" in swiss[-1] and "Empfangsschein" not in "".join(swiss[:-1])
        assert len(swiss) >= len(plain)
        if len(swiss) > len(plain):
            grew = True
            break
    assert grew
