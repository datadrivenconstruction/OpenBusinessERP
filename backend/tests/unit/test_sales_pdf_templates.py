"""Golden renders: every template x document type x language prints its key fields."""

from __future__ import annotations

import io

import pytest
from pypdf import PdfReader

from app.modules.sales.documents.design import TEMPLATES, read_design, sanitise_design, write_design
from app.modules.sales.documents.i18n import fmt_money
from app.modules.sales.documents.pdf import render_sample, sample_document

COMPANY = {
    "company_name": "Muster Bau GmbH",
    "address": "Hauptstraße 1\n10115 Berlin",
    "iban": "DE89370400440532013000",
    "bic": "COBADEFFXXX",
    "bank_name": "Commerzbank",
    "vat_id": "DE811111111",
    "register_court": "AG Berlin-Charlottenburg",
    "register_number": "HRB 12345",
    "managing_directors": "Erika Muster",
    "email": "info@muster.example",
}
KINDS = ("quote", "order", "invoice", "credit_note", "dunning", "purchase_order")


def _text(pdf: bytes) -> list[str]:
    return [_n(p.extract_text() or "") for p in PdfReader(io.BytesIO(pdf)).pages]


def _n(s: str) -> str:
    return " ".join(s.replace(" ", " ").split(" "))


def _company(template: str, **design: object) -> dict:
    return {**COMPANY, "document_design": {"template": template, "terms_text": "Terms apply.", **design}}


@pytest.mark.parametrize("template", TEMPLATES)
@pytest.mark.parametrize("kind", KINDS)
@pytest.mark.parametrize("language", ["en", "de", "ar"])
def test_template_renders_key_fields(template: str, kind: str, language: str) -> None:
    pdf = render_sample(kind, _company(template), language=language, n_lines=4)
    assert pdf.startswith(b"%PDF")
    text = "\n".join(_text(pdf))
    doc = sample_document(
        "order" if kind == "purchase_order" else "invoice" if kind == "dunning" else kind, language, 4
    )
    assert doc.number in text
    assert "12345" in text
    if language != "ar":  # Arabic is shaped into presentation forms, so only ASCII survives extraction verbatim
        assert _n(fmt_money(doc.gross_total, "EUR", language)) in text
        assert doc.customer_name in text


@pytest.mark.parametrize("template", TEMPLATES)
def test_sixty_lines_break_pages_with_carried_totals(template: str) -> None:
    pages = _text(render_sample("invoice", _company(template), language="de", n_lines=60))
    assert len(pages) >= 2
    assert "Zwischensumme (Übertrag)" in pages[0]
    assert "Übertrag" in pages[1] and "Pos." in pages[1]  # header row repeats
    assert f"Seite 1 von {len(pages)}" in pages[0]
    doc = sample_document("invoice", "de", 60)
    assert _n(fmt_money(doc.gross_total, "EUR", "de")) in pages[-1]
    assert "USt. 7 % auf" in "\n".join(pages) and "USt. 19 % auf" in "\n".join(pages)


def test_design_options_render() -> None:
    company = _company(
        "modern",
        font="times",
        logo_position="left",
        logo_size="large",
        header_contact=True,
        page_numbers=False,
        din5008=False,
        fold_marks=False,
        footer_blocks=["bank"],
        accent_color="#aa3300",
    )
    text = "\n".join(_text(render_sample("invoice", company, language="en")))
    assert "Page 1 of" not in text
    assert "DE89 3704 0044 0532 0130 00" in text


def test_design_sanitises_and_persists(tmp_path) -> None:
    clean = sanitise_design({"template": "bogus", "accent_color": "red", "footer_blocks": ["bank", "x"], "din5008": 1})
    assert clean["template"] == "classic" and clean["accent_color"] == "#1f3a5f"
    assert clean["footer_blocks"] == ["bank"] and clean["din5008"] is True
    write_design({"template": "compact", "accent_color": "#00AA00"}, tmp_path)
    assert read_design(tmp_path)["template"] == "compact"
    assert read_design(tmp_path)["accent_color"] == "#00aa00"
