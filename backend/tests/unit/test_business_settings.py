from app.core.business_settings import (
    DEFAULT_BUSINESS_SETTINGS,
    read_business_settings,
    sanitise,
    write_business_settings,
)


def test_unset_file_reads_as_defaults(tmp_path) -> None:
    assert read_business_settings(tmp_path) == DEFAULT_BUSINESS_SETTINGS


def test_invalid_fields_fall_back_alone() -> None:
    out = sanitise(
        {
            "company_name": "  Acme   GmbH ",
            "country_code": "de",
            "base_currency": "EURO",
            "fiscal_year_start_month": 13,
            "industry": "Trade!",
            "company_size": "small",
        }
    )
    assert out["company_name"] == "Acme GmbH"
    assert out["country_code"] == "DE"
    assert out["base_currency"] == ""
    assert out["fiscal_year_start_month"] == 1
    assert out["industry"] == ""
    assert out["company_size"] == "small"


def test_write_merges_and_ignores_none(tmp_path) -> None:
    write_business_settings({"country_code": "DE", "base_currency": "EUR"}, tmp_path)
    out = write_business_settings({"industry": "manufacturing", "country_code": None}, tmp_path)
    assert out["country_code"] == "DE"
    assert out["industry"] == "manufacturing"
    assert read_business_settings(tmp_path) == out


def test_corrupt_file_reads_as_defaults(tmp_path) -> None:
    (tmp_path / "business_settings.json").write_text("{nope", encoding="utf-8")
    assert read_business_settings(tmp_path) == DEFAULT_BUSINESS_SETTINGS


def test_tax_rates_are_cleaned() -> None:
    out = sanitise(
        {
            "tax_rates": [
                {"name": " Standard ", "rate": 19, "default": True},
                {"name": "standard", "rate": 7},
                {"name": "Reduced", "rate": 7, "default": True},
                {"name": "Bad", "rate": 150},
                {"name": "", "rate": 5},
                "junk",
            ]
        }
    )
    assert out["tax_rates"] == [
        {"name": "Standard", "rate": 19.0, "default": True},
        {"name": "Reduced", "rate": 7.0, "default": False},
    ]
    assert sanitise({"tax_rates": "x"})["tax_rates"] == []
