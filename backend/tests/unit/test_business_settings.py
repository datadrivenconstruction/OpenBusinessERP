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


def test_invoice_prefix_and_small_business_are_cleaned() -> None:
    assert sanitise({"invoice_prefix": " re-2026 ", "small_business": True})["invoice_prefix"] == "RE-2026"
    assert sanitise({"invoice_prefix": "bad prefix!"})["invoice_prefix"] == ""
    assert sanitise({"small_business": "yes"})["small_business"] is False


def test_setup_progress_keeps_known_steps_only() -> None:
    out = sanitise({"setup": {"step": 3, "done": ["company", "nope"], "skipped": ["mail"], "finished": "x"}})
    assert out["setup"] == {"step": 3, "done": ["company"], "skipped": ["mail"], "finished": False}
    assert sanitise({"setup": {"step": 99}})["setup"]["step"] == 0


def test_invoice_number_uses_workspace_prefix(tmp_path, monkeypatch) -> None:
    from app.modules.sales.service import prefix_for

    monkeypatch.setenv("OE_DATA_DIR", str(tmp_path))
    assert prefix_for("invoice") == "INV"
    write_business_settings({"invoice_prefix": "RE"}, tmp_path)
    assert prefix_for("invoice") == "RE"
    assert prefix_for("quote") == "QT"


def test_setup_progress_round_trips_through_the_api(tmp_path, monkeypatch) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.core.business_settings_router import router
    from app.dependencies import get_current_user_payload

    monkeypatch.setenv("OE_DATA_DIR", str(tmp_path))
    app = FastAPI()
    app.include_router(router, prefix="/api/v1")
    app.dependency_overrides[get_current_user_payload] = lambda: {"sub": "u1", "role": "admin"}
    client = TestClient(app)
    body = {"setup": {"step": 2, "done": ["company", "tax"], "skipped": []}, "invoice_prefix": "re"}
    res = client.put("/api/v1/business-settings/", json=body)
    assert res.status_code == 200, res.text
    got = client.get("/api/v1/business-settings/").json()
    assert got["setup"]["done"] == ["company", "tax"]
    assert got["invoice_prefix"] == "RE"
