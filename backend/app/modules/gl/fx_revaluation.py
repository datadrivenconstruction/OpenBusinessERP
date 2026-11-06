"""Period-end revaluation of open foreign-currency receivables and payables.

Each open item is restated from its document rate to the closing rate; the difference is posted on the
period end as unrealised FX gain/loss and reversed on the first day of the next period, so realised
settlement keeps working against the original document rate.
"""

from __future__ import annotations

import uuid
from datetime import date, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.modules.gl.fx_posting import FxRateMissingError, fx_account_ids, q_rate, resolve_doc_rate
from app.modules.gl.models import GLJournalEntry
from app.modules.gl.service import GLConflictError, GLService, GLValidationError, LineInput, base_currency, money

SOURCE_REVAL = "fx_revaluation"
ZERO = Decimal("0.00")


async def _open_items(session: AsyncSession, tenant_id: str, as_of: date) -> list[dict[str, Any]]:
    from app.modules.purchasing.models import PurchasingBill
    from app.modules.sales.models import SalesDocument

    base = base_currency()
    out: list[dict[str, Any]] = []
    sales = (
        await session.execute(
            select(SalesDocument)
            .options(selectinload(SalesDocument.payments))
            .where(
                SalesDocument.tenant_id == tenant_id,
                SalesDocument.kind == "invoice",
                SalesDocument.status.in_(("issued", "partially_paid", "paid")),
                SalesDocument.currency != base,
                SalesDocument.doc_date <= as_of,
            )
        )
    ).scalars()
    bills = (
        await session.execute(
            select(PurchasingBill)
            .options(selectinload(PurchasingBill.payments))
            .where(
                PurchasingBill.tenant_id == tenant_id,
                PurchasingBill.kind == "bill",
                PurchasingBill.status.in_(("posted", "partially_paid", "paid")),
                PurchasingBill.currency != base,
                PurchasingBill.doc_date <= as_of,
            )
        )
    ).scalars()
    for side, docs in (("receivable", sales), ("payable", bills)):
        for d in docs:
            # Payments after the closing date were still open on it.
            later = sum((p.amount for p in d.payments if p.pay_date > as_of), ZERO)
            open_amt = d.gross_total - d.amount_paid + later
            if open_amt > 0:
                name = getattr(d, "customer_name", None) or getattr(d, "supplier_name", "")
                out.append(
                    {
                        "side": side,
                        "id": str(d.id),
                        "number": d.number,
                        "party": name,
                        "currency": d.currency,
                        "open": open_amt,
                        "doc_rate": d.fx_rate,
                    }
                )
    return out


async def preview(
    session: AsyncSession, tenant_id: str, period_end: date, rates: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Rows per open item with booked and revalued base amounts; ``rates`` overrides closing rates per currency."""
    manual = {k.upper(): q_rate(Decimal(str(v))) for k, v in (rates or {}).items() if v not in (None, "", 0)}
    closing: dict[str, Decimal] = {}
    rows = []
    totals = {"receivable": ZERO, "payable": ZERO}
    for it in await _open_items(session, tenant_id, period_end):
        ccy = it["currency"]
        if ccy not in closing:
            try:
                closing[ccy] = manual.get(ccy) or await resolve_doc_rate(session, ccy, period_end)
            except FxRateMissingError as exc:
                raise GLValidationError(str(exc)) from exc
        booked = money(it["open"] * it["doc_rate"])
        revalued = money(it["open"] * closing[ccy])
        diff = revalued - booked
        # Receivable worth more = gain; payable worth more = loss.
        gain = diff if it["side"] == "receivable" else -diff
        totals[it["side"]] += diff
        rows.append({**it, "closing_rate": closing[ccy], "booked": booked, "revalued": revalued, "gain": gain})
    net = sum((r["gain"] for r in rows), ZERO)
    return {
        "period_end": period_end,
        "reversal_date": period_end + timedelta(days=1),
        "base_currency": base_currency(),
        "rates": closing,
        "rows": rows,
        "receivable_diff": totals["receivable"],
        "payable_diff": totals["payable"],
        "net_gain": net,
        "posted": await _existing(session, tenant_id, period_end) is not None,
    }


async def _existing(session: AsyncSession, tenant_id: str, period_end: date) -> GLJournalEntry | None:
    return await session.scalar(
        select(GLJournalEntry).where(
            GLJournalEntry.tenant_id == tenant_id,
            GLJournalEntry.source_type == SOURCE_REVAL,
            GLJournalEntry.source_id == period_end.isoformat(),
            GLJournalEntry.reversal_of_id.is_(None),
        )
    )


async def post(
    session: AsyncSession,
    tenant_id: str,
    period_end: date,
    rates: dict[str, Any] | None = None,
    created_by: str | None = None,
) -> dict[str, Any]:
    """Post the revaluation on ``period_end`` and its reversal on the next day (once per closing date)."""
    from app.modules.purchasing.service import PurchasingError, PurchasingService
    from app.modules.sales.service import SalesError, SalesService

    if await _existing(session, tenant_id, period_end) is not None:
        raise GLConflictError(f"FX revaluation for {period_end} is already posted")
    pv = await preview(session, tenant_id, period_end, rates)
    ar, ap = pv["receivable_diff"], pv["payable_diff"]
    if not ar and not ap:
        return {**pv, "entry_id": None, "reversal_id": None}
    gain_id, loss_id = await fx_account_ids(session, tenant_id)
    if gain_id is None or loss_id is None:
        raise GLValidationError("FX gain/loss accounts are missing from the chart of accounts")
    lines: list[LineInput] = []
    try:
        if ar:
            rec = (await SalesService(session, tenant_id)._accounts("receivable"))["receivable"]
            lines.append(_line(rec, ar, "FX revaluation receivables"))
        if ap:
            pay = (await PurchasingService(session, tenant_id)._accounts("payables"))["payables"]
            lines.append(_line(pay, -ap, "FX revaluation payables"))
    except (SalesError, PurchasingError) as exc:
        raise GLConflictError(str(exc)) from exc
    net = pv["net_gain"]
    if net:
        lines.append(_line(gain_id if net > 0 else loss_id, -net, "Unrealised FX " + ("gain" if net > 0 else "loss")))
    gl = GLService(session, tenant_id)
    entry = await gl.create_entry(
        entry_date=period_end,
        lines=lines,
        memo=f"Unrealised FX revaluation {period_end}",
        source_type=SOURCE_REVAL,
        source_id=period_end.isoformat(),
        created_by=created_by,
        post=True,
    )
    rev = await gl.reverse_entry(
        entry.id, on=pv["reversal_date"], memo=f"Reverse FX revaluation {period_end}", created_by=created_by
    )
    return {**pv, "posted": True, "entry_id": entry.id, "reversal_id": rev.id}


def _line(account: uuid.UUID, amount: Decimal, desc: str) -> LineInput:
    """Positive = debit, negative = credit."""
    return (
        LineInput(account, debit=amount, description=desc)
        if amount > 0
        else LineInput(account, credit=-amount, description=desc)
    )
