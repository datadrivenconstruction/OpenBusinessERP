"""Online payment links: encrypted settings, provider calls on a mock transport, signed webhooks, booking once."""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from datetime import date
from decimal import Decimal

import httpx
import pytest
import pytest_asyncio

from app.core import payment_settings as ps
from app.modules.gl import service as gl_service
from app.modules.gl.service import GLService
from app.modules.sales import online_payments as op
from app.modules.sales.documents.pdf import render_document
from app.modules.sales.service import LineData, SalesService
from tests._pg import transactional_session

D = Decimal
WHSEC = "whsec_unit"


@pytest.fixture(autouse=True)
def _env(monkeypatch, tmp_path):
    monkeypatch.setattr(gl_service, "read_business_settings", lambda: {"base_currency": "EUR"})
    monkeypatch.setattr(ps, "resolve_data_dir", lambda: tmp_path)


@pytest.fixture
def calls(monkeypatch):
    seen: list[httpx.Request] = []

    def handler(req: httpx.Request) -> httpx.Response:
        seen.append(req)
        if req.url.path == "/v1/checkout/sessions":
            return httpx.Response(200, json={"id": "cs_test_1", "url": "https://checkout.stripe.com/c/pay/cs_test_1"})
        if req.url.path == "/v2/payments":
            body = json.loads(req.content)
            return httpx.Response(
                201,
                json={
                    "id": "tr_abc",
                    "amount": body["amount"],
                    "_links": {"checkout": {"href": "https://mollie.test/x"}},
                },
            )
        if req.url.path == "/v2/payments/tr_abc":
            return httpx.Response(
                200, json={"id": "tr_abc", "status": "paid", "amount": {"currency": "EUR", "value": "119.00"}}
            )
        if req.url.path == "/v1/balance":
            return httpx.Response(401, json={"error": {"message": "Invalid API Key provided"}})
        return httpx.Response(404, json={})

    monkeypatch.setattr(op, "client_factory", lambda: httpx.AsyncClient(transport=httpx.MockTransport(handler)))
    return seen


@pytest_asyncio.fixture
async def session():
    async with transactional_session() as s:
        yield s


async def _invoice(session):
    gl = GLService(session, "default")
    await gl.load_template("de_skr03")
    await gl.create_fiscal_year("FY2026", date(2026, 1, 1), date(2026, 12, 31))
    sales = SalesService(session, "default")
    inv = await sales.create(
        "invoice",
        lines=[LineData("Consulting", "", D(1), D("100.00"), D(0), D(19))],
        doc_date=date(2026, 3, 1),
        customer_name="Kunde GmbH",
    )
    return gl, sales, await sales.issue_invoice(inv.id)


def _signed(event: dict, secret: str = WHSEC, ts: int | None = None) -> tuple[bytes, str]:
    payload = json.dumps(event).encode()
    ts = ts or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
    return payload, f"t={ts},v1={sig}"


def _event(session_id="cs_test_1", amount=11900) -> dict:
    obj = {"id": session_id, "payment_status": "paid", "amount_total": amount, "currency": "eur"}
    return {"type": "checkout.session.completed", "data": {"object": obj}}


def test_secrets_are_encrypted_and_never_returned(tmp_path):
    out = ps.write_payment_settings(
        {"provider": "stripe", "stripe_secret_key": "sk_test_abc", "stripe_webhook_secret": WHSEC}
    )
    raw = (tmp_path / "payment_settings.json").read_text(encoding="utf-8")
    assert "sk_test_abc" not in raw and WHSEC not in raw
    assert "sk_test_abc" not in json.dumps(out)
    assert out["stripe_secret_key_set"] and out["configured"] and out["test_mode"] is True
    assert ps.secrets()["stripe_secret_key"] == "sk_test_abc"
    ps.write_payment_settings({"stripe_secret_key": None})  # None keeps
    assert ps.secrets()["stripe_secret_key"] == "sk_test_abc"
    assert ps.write_payment_settings({"provider": "mollie", "mollie_api_key": "live_x"})["test_mode"] is False


def test_stripe_signature_checks():
    prov = op.StripeProvider({**ps.DEFAULT_PAYMENT_SETTINGS, "stripe_webhook_secret": WHSEC})
    payload, header = _signed(_event())
    assert prov.verify(payload, header)["type"] == "checkout.session.completed"
    with pytest.raises(op.WebhookRejectedError, match="mismatch"):
        prov.verify(payload + b" ", header)
    with pytest.raises(op.WebhookRejectedError, match="mismatch"):
        prov.verify(*_signed(_event(), secret="whsec_other"))
    with pytest.raises(op.WebhookRejectedError, match="tolerance"):
        prov.verify(*_signed(_event(), ts=int(time.time()) - 3600))
    with pytest.raises(op.WebhookRejectedError):
        prov.verify(payload, "garbage")


async def test_stripe_link_then_webhook_books_once(session, calls):
    ps.write_payment_settings(
        {
            "provider": "stripe",
            "stripe_secret_key": "sk_test_abc",
            "stripe_webhook_secret": WHSEC,
            "public_base_url": "https://erp.example.com",
        }
    )
    gl, sales, inv = await _invoice(session)
    link = await op.ensure_link(session, inv)
    assert link.url.startswith("https://checkout.stripe.com/") and link.amount == D("119.00")
    sent = calls[0]
    assert sent.headers["authorization"] == "Bearer sk_test_abc"
    assert b"line_items%5B0%5D%5Bprice_data%5D%5Bunit_amount%5D=11900" in sent.content
    assert await op.ensure_link(session, inv) is link and len(calls) == 1  # reused, no second call

    paid = op.StripeProvider.payment_from_event(_event())
    assert await op.settle(session, "stripe", paid) == "recorded"
    assert await op.settle(session, "stripe", paid) == "duplicate"
    inv = await sales.get(inv.id, "invoice")
    assert inv.status == "paid" and len(inv.payments) == 1 and inv.payments[0].method == "stripe"
    tb = await gl.trial_balance(None, None)
    bal = {r["code"]: r["closing"] for r in tb["rows"]}
    assert tb["balanced"] and bal["1360"] == D("119.00") and bal.get("1400", D(0)) == D(0)

    pdf = render_document(inv, {"company_name": "X"}, payment_url=link.url)
    assert pdf.startswith(b"%PDF")


async def test_mollie_fetch_verifies_and_partial_payment(session, calls):
    ps.write_payment_settings(
        {"provider": "mollie", "mollie_api_key": "test_key", "public_base_url": "https://erp.example.com"}
    )
    gl, sales, inv = await _invoice(session)
    await sales.record_payment(inv.id, amount=D("19.00"))
    inv = await sales.get(inv.id, "invoice")
    link = await op.ensure_link(session, inv)
    assert json.loads(calls[0].content)["webhookUrl"] == "https://erp.example.com/api/v1/sales/payment-webhooks/mollie/"
    assert link.amount == D("100.00")
    paid = await op.MollieProvider(ps.secrets()).fetch("tr_abc")
    assert paid.paid and paid.amount == D("119.00")
    # Mollie says 119 but only 100 is open: apply 100, never more than the balance.
    assert await op.settle(session, "mollie", paid) == "recorded"
    inv = await sales.get(inv.id, "invoice")
    assert inv.status == "paid" and inv.amount_paid == D("119.00")
    assert await op.settle(session, "mollie", op.ProviderPayment("tr_unknown", True, D(1), "EUR")) == "unknown"


async def test_test_connection_reports_refusal_without_secret(calls):
    prov = op.StripeProvider({**ps.DEFAULT_PAYMENT_SETTINGS, "stripe_secret_key": "sk_test_secret"})
    with pytest.raises(op.PaymentProviderError) as exc:
        await prov.test()
    assert "401" in str(exc.value) and "sk_test_secret" not in str(exc.value)
