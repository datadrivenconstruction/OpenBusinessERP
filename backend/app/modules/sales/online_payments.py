"""Online payment links for invoices (Stripe Checkout, Mollie Payments) and their webhooks.

A link row (``oe_sales_payment_link``) is created when an invoice is sent; the provider's
webhook settles it exactly once: the row is claimed with a conditional UPDATE keyed by the
provider's id, then the payment is booked through ``SalesService.record_payment`` against
the provider clearing account (bank transit), never against the bank itself.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

import httpx
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.payment_settings import secrets
from app.modules.gl.models import GLAccount
from app.modules.sales.models import SalesDocument, SalesPaymentLink

logger = logging.getLogger(__name__)

STRIPE_API = "https://api.stripe.com"
MOLLIE_API = "https://api.mollie.com"
STRIPE_TOLERANCE_S = 300
# ISO 4217 currencies without minor units at Stripe / Mollie.
ZERO_DECIMAL = {
    "BIF",
    "CLP",
    "DJF",
    "GNF",
    "JPY",
    "KMF",
    "KRW",
    "MGA",
    "PYG",
    "RWF",
    "UGX",
    "VND",
    "VUV",
    "XAF",
    "XOF",
    "XPF",
}

# Tests swap this for a factory returning a client on ``httpx.MockTransport``.
client_factory: Callable[[], httpx.AsyncClient] = lambda: httpx.AsyncClient(timeout=20)  # noqa: E731


class PaymentProviderError(Exception):
    """Provider unreachable, misconfigured or refused the request. Message never contains secrets."""


class WebhookRejectedError(Exception):
    pass


@dataclass
class CreatedLink:
    provider_ref: str
    url: str


@dataclass
class ProviderPayment:
    provider_ref: str
    paid: bool
    amount: Decimal
    currency: str


def _places(currency: str) -> int:
    return 0 if currency.upper() in ZERO_DECIMAL else 2


def to_minor(amount: Decimal, currency: str) -> int:
    return int((amount * (10 ** _places(currency))).quantize(Decimal(1), ROUND_HALF_UP))


def from_minor(value: int, currency: str) -> Decimal:
    return (Decimal(value) / (10 ** _places(currency))).quantize(Decimal("0.01"))


async def _request(method: str, url: str, **kw: Any) -> dict[str, Any]:
    try:
        async with client_factory() as client:
            resp = await client.request(method, url, **kw)
    except httpx.HTTPError as exc:
        raise PaymentProviderError(f"Provider not reachable ({type(exc).__name__})") from None
    try:
        data = resp.json()
    except ValueError:
        data = {}
    if resp.status_code >= 400:
        err = data.get("error") if isinstance(data.get("error"), dict) else {}
        detail = err.get("message") or data.get("detail") or data.get("title") or ""
        raise PaymentProviderError(f"Provider refused the request (HTTP {resp.status_code}) {detail}".strip()[:300])
    return data


class StripeProvider:
    name = "stripe"

    def __init__(self, cfg: dict[str, Any]):
        self.key = cfg["stripe_secret_key"]
        self.webhook_secret = cfg["stripe_webhook_secret"]
        self.return_url = cfg["return_url"] or cfg["public_base_url"]

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.key}"}

    async def test(self) -> None:
        await _request("GET", f"{STRIPE_API}/v1/balance", headers=self._auth())

    async def create(self, doc: SalesDocument, amount: Decimal, description: str) -> CreatedLink:
        if not self.return_url:
            raise PaymentProviderError("Set a return URL or public base URL for Stripe Checkout")
        form = {
            "mode": "payment",
            "success_url": self.return_url,
            "client_reference_id": str(doc.id),
            "line_items[0][quantity]": "1",
            "line_items[0][price_data][currency]": doc.currency.lower(),
            "line_items[0][price_data][unit_amount]": str(to_minor(amount, doc.currency)),
            "line_items[0][price_data][product_data][name]": description[:250],
            "metadata[invoice_id]": str(doc.id),
            "metadata[invoice_number]": doc.number,
        }
        if doc.customer_email:
            form["customer_email"] = doc.customer_email
        data = await _request("POST", f"{STRIPE_API}/v1/checkout/sessions", headers=self._auth(), data=form)
        if not data.get("id") or not data.get("url"):
            raise PaymentProviderError("Stripe returned no checkout URL")
        return CreatedLink(data["id"], data["url"])

    def verify(self, payload: bytes, header: str, now: float | None = None) -> dict[str, Any]:
        """Check ``Stripe-Signature`` (HMAC-SHA256 over ``t.payload``) and return the event."""
        if not self.webhook_secret:
            raise WebhookRejectedError("Stripe webhook secret not configured")
        parts: dict[str, list[str]] = {}
        for item in (header or "").split(","):
            k, _, v = item.strip().partition("=")
            parts.setdefault(k, []).append(v)
        try:
            ts = int(parts.get("t", [""])[0])
        except ValueError:
            raise WebhookRejectedError("Malformed Stripe-Signature") from None
        if abs((now if now is not None else time.time()) - ts) > STRIPE_TOLERANCE_S:
            raise WebhookRejectedError("Stripe signature timestamp outside tolerance")
        expected = hmac.new(self.webhook_secret.encode(), f"{ts}.".encode() + payload, hashlib.sha256).hexdigest()
        if not any(hmac.compare_digest(expected, sig) for sig in parts.get("v1", [])):
            raise WebhookRejectedError("Stripe signature mismatch")
        try:
            return json.loads(payload)
        except ValueError:
            raise WebhookRejectedError("Malformed Stripe payload") from None

    @staticmethod
    def payment_from_event(event: dict[str, Any]) -> ProviderPayment | None:
        if event.get("type") not in ("checkout.session.completed", "checkout.session.async_payment_succeeded"):
            return None
        obj = (event.get("data") or {}).get("object") or {}
        currency = str(obj.get("currency") or "").upper()
        return ProviderPayment(
            provider_ref=str(obj.get("id") or ""),
            paid=obj.get("payment_status") == "paid",
            amount=from_minor(int(obj.get("amount_total") or 0), currency),
            currency=currency,
        )


class MollieProvider:
    name = "mollie"

    def __init__(self, cfg: dict[str, Any]):
        self.key = cfg["mollie_api_key"]
        self.base = cfg["public_base_url"]
        self.return_url = cfg["return_url"] or cfg["public_base_url"]

    def _auth(self) -> dict[str, str]:
        return {"Authorization": f"Bearer {self.key}"}

    async def test(self) -> None:
        await _request("GET", f"{MOLLIE_API}/v2/methods", headers=self._auth())

    async def create(self, doc: SalesDocument, amount: Decimal, description: str) -> CreatedLink:
        if not self.base or not self.return_url:
            raise PaymentProviderError("Set the public base URL so Mollie can reach the webhook")
        body = {
            "amount": {"currency": doc.currency.upper(), "value": f"{amount:.{_places(doc.currency)}f}"},
            "description": description[:255],
            "redirectUrl": self.return_url,
            "webhookUrl": f"{self.base}/api/v1/sales/payment-webhooks/mollie/",
            "metadata": {"invoice_id": str(doc.id), "invoice_number": doc.number},
        }
        data = await _request("POST", f"{MOLLIE_API}/v2/payments", headers=self._auth(), json=body)
        href = ((data.get("_links") or {}).get("checkout") or {}).get("href")
        if not data.get("id") or not href:
            raise PaymentProviderError("Mollie returned no checkout URL")
        return CreatedLink(data["id"], href)

    async def fetch(self, payment_id: str) -> ProviderPayment:
        """Mollie webhooks carry only an id; the authoritative state is fetched with our API key."""
        data = await _request("GET", f"{MOLLIE_API}/v2/payments/{payment_id}", headers=self._auth())
        amount = data.get("amount") or {}
        return ProviderPayment(
            provider_ref=str(data.get("id") or ""),
            paid=data.get("status") == "paid",
            amount=Decimal(str(amount.get("value") or "0")).quantize(Decimal("0.01")),
            currency=str(amount.get("currency") or "").upper(),
        )


def provider(cfg: dict[str, Any] | None = None) -> StripeProvider | MollieProvider | None:
    cfg = cfg or secrets()
    if cfg["provider"] == "stripe" and cfg["stripe_secret_key"]:
        return StripeProvider(cfg)
    if cfg["provider"] == "mollie" and cfg["mollie_api_key"]:
        return MollieProvider(cfg)
    return None


# ── Links ─────────────────────────────────────────────────────────────────
async def open_link(session: AsyncSession, doc: SalesDocument) -> SalesPaymentLink | None:
    """Latest unsettled link whose amount still matches the open balance."""
    row = await session.scalar(
        select(SalesPaymentLink)
        .where(
            SalesPaymentLink.tenant_id == doc.tenant_id,
            SalesPaymentLink.invoice_id == doc.id,
            SalesPaymentLink.status == "open",
        )
        .order_by(SalesPaymentLink.created_at.desc())
        .limit(1)
    )
    return row if row is not None and row.amount == doc.balance_due else None


async def ensure_link(session: AsyncSession, doc: SalesDocument) -> SalesPaymentLink | None:
    """Payment link for an open invoice, or None when no provider is configured or nothing is due."""
    if doc.kind != "invoice" or doc.status not in ("issued", "partially_paid") or doc.balance_due <= 0:
        return None
    prov = provider()
    if prov is None:
        return None
    existing = await open_link(session, doc)
    if existing is not None and existing.provider == prov.name:
        return existing
    amount = doc.balance_due
    created = await prov.create(doc, amount, f"Invoice {doc.number}")
    link = SalesPaymentLink(
        id=uuid.uuid4(),
        tenant_id=doc.tenant_id,
        invoice_id=doc.id,
        provider=prov.name,
        provider_ref=created.provider_ref,
        url=created.url,
        amount=amount,
        currency=doc.currency.upper(),
        status="open",
    )
    session.add(link)
    await session.flush()
    return link


# ── Settlement ────────────────────────────────────────────────────────────
async def _clearing_account(session: AsyncSession, svc: Any, code: str) -> uuid.UUID:
    tenant = svc.tenant_id
    if not code:
        tpl = await session.scalar(
            select(GLAccount.template).where(GLAccount.tenant_id == tenant, GLAccount.template.is_not(None)).limit(1)
        )
        code = "1360" if tpl == "de_skr03" else ""
    if code:
        acc = await session.scalar(select(GLAccount.id).where(GLAccount.tenant_id == tenant, GLAccount.code == code))
        if acc is not None:
            return acc
    return (await svc._accounts("bank"))["bank"]


async def settle(session: AsyncSession, provider_name: str, paid: ProviderPayment) -> str:
    """Book a confirmed provider payment once. Returns an outcome tag for the webhook response."""
    from app.modules.sales.service import SalesService

    if not paid.provider_ref:
        return "ignored"
    link = await session.scalar(
        select(SalesPaymentLink).where(
            SalesPaymentLink.provider == provider_name, SalesPaymentLink.provider_ref == paid.provider_ref
        )
    )
    if link is None:
        return "unknown"
    if not paid.paid:
        return "pending"
    if paid.currency and paid.currency != link.currency:
        logger.warning("payment %s currency %s differs from link %s", link.id, paid.currency, link.currency)
        return "currency_mismatch"
    # Atomic claim: concurrent or repeated deliveries see rowcount 0 and stop here.
    claimed = await session.execute(
        update(SalesPaymentLink)
        .where(SalesPaymentLink.id == link.id, SalesPaymentLink.status == "open")
        .values(status="processing")
    )
    if claimed.rowcount != 1:
        return "duplicate"
    cfg = secrets()
    svc = SalesService(session, link.tenant_id)
    inv = await session.get(SalesDocument, link.invoice_id)
    amount = min(paid.amount, inv.balance_due) if inv is not None else Decimal(0)
    if inv is None or inv.status not in ("issued", "partially_paid") or amount <= 0:
        link.status = "unapplied"
        link.paid_amount = paid.amount
        await session.flush()
        logger.warning("payment link %s paid but invoice is not open; left unapplied", link.id)
        return "unapplied"
    account = await _clearing_account(session, svc, cfg["clearing_account_code"])
    await svc.record_payment(
        inv.id,
        amount=amount,
        pay_date=date.today(),
        method=provider_name,
        reference=paid.provider_ref[:128],
        debit_account_id=account,
    )
    pay = inv.payments[-1] if inv.payments else None  # record_payment appends the new row
    link.status = "paid"
    link.paid_amount = paid.amount
    link.payment_id = pay.id if pay is not None else None
    await session.flush()
    if paid.amount > amount:
        logger.warning("payment link %s overpaid by %s; excess not applied", link.id, paid.amount - amount)
    return "recorded"
