"""Foreign-currency helpers for document posting.

``fx_rate`` on a document is base-currency units per one document-currency unit
(EUR company, USD invoice: 1 USD = 0.92 EUR -> fx_rate 0.92).  Payments of
foreign documents are posted in base currency so that the bank side uses the
payment-date rate, the open item is cleared at the document rate and the
difference lands on the realized FX gain/loss account.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.gl.models import GLAccount
from app.modules.gl.service import LineInput, base_currency, money

RATE_Q = Decimal("0.0000000001")
ZERO = Decimal("0.00")

# Realized exchange-rate difference accounts per chart template (gain, loss).
FX_ACCOUNTS: dict[str, tuple[str, str]] = {
    "de_skr03": ("2660", "2150"),  # Erträge / Aufwendungen aus Kursdifferenzen
    "ifrs_generic": ("4300", "5700"),
}


class FxRateMissingError(LookupError):
    pass


def q_rate(v: Decimal) -> Decimal:
    return Decimal(v).quantize(RATE_Q, rounding=ROUND_HALF_UP)


async def resolve_doc_rate(session: AsyncSession, currency: str, on_date: date | None) -> Decimal:
    """Base units per one ``currency`` from the FX register (rate set, cache, then bundled seed)."""
    from app.modules.fx.service import FxService, _rebase

    base = base_currency()
    ccy = (currency or base).upper()
    if ccy == base:
        return Decimal(1)
    resolved = await FxService(session).resolve_rates(base_currency=base, on_date=on_date)
    try:
        rates = _rebase(resolved.rates, resolved.base_currency, base)
    except Exception as exc:  # noqa: BLE001 - unknown base in the register
        raise FxRateMissingError(f"No {base} rates on file; enter fx_rate manually") from exc
    per_base = rates.get(ccy)
    if not per_base:
        raise FxRateMissingError(f"No {ccy}/{base} rate on file for {on_date}; enter fx_rate manually")
    return q_rate(Decimal(1) / Decimal(per_base))


async def rate_for(session: AsyncSession, currency: str, on_date: date | None, manual: object | None) -> Decimal:
    """Manual override wins; otherwise the register rate (1 for base currency)."""
    if (currency or "").upper() == base_currency():
        return Decimal(1)
    if manual not in (None, "", 0):
        return q_rate(Decimal(str(manual)))
    return await resolve_doc_rate(session, currency, on_date)


async def fx_account_ids(session: AsyncSession, tenant_id: str) -> tuple[uuid.UUID | None, uuid.UUID | None]:
    tpl = await session.scalar(
        select(GLAccount.template).where(GLAccount.tenant_id == tenant_id, GLAccount.template.is_not(None)).limit(1)
    )
    gain_code, loss_code = FX_ACCOUNTS.get(tpl or "", FX_ACCOUNTS["ifrs_generic"])

    async def _id(code: str) -> uuid.UUID | None:
        return await session.scalar(
            select(GLAccount.id).where(GLAccount.tenant_id == tenant_id, GLAccount.code == code)
        )

    return await _id(gain_code), await _id(loss_code)


@dataclass
class Settlement:
    base_cash: Decimal  # cash side in base currency (payment rate)
    base_open: Decimal  # open item cleared in base currency (document rate)
    diff: Decimal  # >0 gain for receivables, loss for payables


def settlement(amount: Decimal, doc_rate: Decimal, pay_rate: Decimal, base_amount: Decimal | None = None) -> Settlement:
    cash = money(base_amount) if base_amount is not None else money(amount * pay_rate)
    open_ = money(amount * doc_rate)
    return Settlement(cash, open_, cash - open_)


async def settlement_lines(
    session: AsyncSession,
    tenant_id: str,
    *,
    s: Settlement,
    cash_account: uuid.UUID,
    open_account: uuid.UUID,
    incoming: bool,
    label: str,
) -> list[LineInput]:
    """Base-currency lines: incoming = DR cash / CR receivable; outgoing = DR payable / CR cash; diff to FX."""
    lines = (
        [
            LineInput(cash_account, debit=s.base_cash, description=label),
            LineInput(open_account, credit=s.base_open, description=label),
        ]
        if incoming
        else [
            LineInput(open_account, debit=s.base_open, description=label),
            LineInput(cash_account, credit=s.base_cash, description=label),
        ]
    )
    # Receivable: more cash than booked = gain. Payable: more cash than booked = loss.
    gain = s.diff if incoming else -s.diff
    if gain != 0:
        gain_id, loss_id = await fx_account_ids(session, tenant_id)
        acc = gain_id if gain > 0 else loss_id
        if acc is None:
            raise FxRateMissingError("Realized FX gain/loss account is missing from the chart of accounts")
        lines.append(
            LineInput(acc, credit=gain, description=f"FX gain {label}")
            if gain > 0
            else LineInput(acc, debit=-gain, description=f"FX loss {label}")
        )
    return [ln for ln in lines if (ln.debit or ln.credit)]
