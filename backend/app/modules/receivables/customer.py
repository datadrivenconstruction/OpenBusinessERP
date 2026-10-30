"""Customer drill-down for receivables: open items, payment behaviour, dunning trail, follow-up log.

Payment promises and notes are a collector's record only; nothing here contacts the customer.
"""

from __future__ import annotations

import uuid
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.banking.service import partner_key
from app.modules.gl.models import DEFAULT_TENANT
from app.modules.receivables.models import ArFollowUp, DunningLetter
from app.modules.receivables.service import (
    BUCKETS,
    ZERO,
    ReceivablesConflictError,
    ReceivablesNotFoundError,
    ReceivablesService,
    ReceivablesValidationError,
    money,
)
from app.modules.sales.models import SalesDocument, SalesPayment

PROMISE_STATUSES = ("open", "kept", "broken", "cancelled")


def payment_stats(payments: list[dict[str, Any]]) -> dict[str, Any]:
    """Amount-weighted average days from invoice date to payment, and days past due."""
    paid = [p for p in payments if p["amount"] > 0]
    total = sum((p["amount"] for p in paid), ZERO)
    if not total:
        return {"avg_days_to_pay": None, "avg_days_late": None, "on_time_share": None, "paid_total": ZERO}
    to_pay = sum((p["amount"] * p["days_to_pay"] for p in paid), ZERO) / total
    late = sum((p["amount"] * max(p["days_late"], 0) for p in paid), ZERO) / total
    on_time = sum((p["amount"] for p in paid if p["days_late"] <= 0), ZERO) / total
    return {
        "avg_days_to_pay": round(float(to_pay), 1),
        "avg_days_late": round(float(late), 1),
        "on_time_share": round(float(on_time) * 100),
        "paid_total": money(total),
    }


def followup_out(f: ArFollowUp, as_of: date | None = None) -> dict[str, Any]:
    as_of = as_of or date.today()
    return {
        "id": f.id,
        "partner_key": f.partner_key,
        "customer_name": f.customer_name,
        "kind": f.kind,
        "text": f.text,
        "invoice_id": f.invoice_id,
        "invoice_number": f.invoice_number,
        "promised_date": f.promised_date,
        "promised_amount": f.promised_amount,
        "status": f.status,
        "overdue": bool(f.kind == "promise" and f.status == "open" and f.promised_date and f.promised_date < as_of),
        "created_at": f.created_at,
        "created_by": f.created_by,
    }


class CustomerAccountService:
    def __init__(self, session: AsyncSession, tenant_id: str = DEFAULT_TENANT) -> None:
        self.session = session
        self.tenant_id = tenant_id
        self.rec = ReceivablesService(session, tenant_id)

    @staticmethod
    def _customer_filter(key: str):
        if key.startswith("name:"):
            return SalesDocument.customer_id.is_(None)
        try:
            return SalesDocument.customer_id == uuid.UUID(key)
        except ValueError as exc:
            raise ReceivablesValidationError("Unknown customer key") from exc

    async def payments(self, key: str, limit: int = 200) -> list[dict[str, Any]]:
        D, P = SalesDocument, SalesPayment
        q = (
            select(P, D)
            .join(D, P.invoice_id == D.id)
            .where(
                P.tenant_id == self.tenant_id,
                D.tenant_id == self.tenant_id,
                D.kind == "invoice",
                self._customer_filter(key),
            )
            .order_by(P.pay_date.desc())
        )
        out: list[dict[str, Any]] = []
        for pay, inv in (await self.session.execute(q)).all():
            if partner_key(inv.customer_id, inv.customer_name) != key:
                continue
            due = inv.due_date or inv.doc_date
            out.append(
                {
                    "id": pay.id,
                    "invoice_id": inv.id,
                    "invoice_number": inv.number,
                    "pay_date": pay.pay_date,
                    "amount": money(pay.amount),
                    "currency": inv.currency,
                    "method": pay.method,
                    "reference": pay.reference,
                    "days_to_pay": (pay.pay_date - inv.doc_date).days,
                    "days_late": (pay.pay_date - due).days,
                }
            )
            if len(out) >= limit:
                break
        return out

    async def followups(self, key: str) -> list[ArFollowUp]:
        F = ArFollowUp
        q = select(F).where(F.tenant_id == self.tenant_id, F.partner_key == key).order_by(F.created_at.desc())
        return list((await self.session.execute(q)).scalars())

    async def promises(self, status: str | None = "open") -> list[ArFollowUp]:
        F = ArFollowUp
        q = select(F).where(F.tenant_id == self.tenant_id, F.kind == "promise")
        if status:
            q = q.where(F.status == status)
        return list((await self.session.execute(q.order_by(F.promised_date))).scalars())

    async def detail(self, key: str, as_of: date | None = None) -> dict[str, Any]:
        as_of = as_of or date.today()
        aging = await self.rec.aging(as_of)
        row: dict[str, Any] = next((r for r in aging["rows"] if r["partner_key"] == key), None) or {}
        payments = await self.payments(key)
        L = DunningLetter
        letters = list(
            (
                await self.session.execute(
                    select(L)
                    .where(L.tenant_id == self.tenant_id, L.partner_key == key, L.status != "discarded")
                    .order_by(L.letter_date.desc())
                )
            ).scalars()
        )
        follow = await self.followups(key)
        if not row and not payments and not letters and not follow:
            raise ReceivablesNotFoundError("Customer has no receivables history")
        name = row.get("customer_name") or next((x.customer_name for x in [*letters, *follow] if x.customer_name), "")
        buckets = {b: row.get(b, ZERO) for b in BUCKETS}
        total = row.get("total", ZERO)
        open_promises = [f for f in follow if f.kind == "promise" and f.status == "open"]
        return {
            "partner_key": key,
            "customer_name": name,
            "as_of": as_of,
            "blocked": any(b.partner_key == key for b in await self.rec.blocks()),
            "open_total": total,
            "overdue_total": money(total - buckets["current"]),
            "buckets": buckets,
            "invoices": row.get("invoices", []),
            "payments": payments,
            "stats": payment_stats(payments),
            "letters": letters,
            "followups": [followup_out(f, as_of) for f in follow],
            "promised_open": money(sum((f.promised_amount or ZERO for f in open_promises), ZERO)),
            "next_dunning": await self.rec.preview_run(as_of, key),
        }

    async def add(self, data: dict[str, Any], by: str | None = None) -> ArFollowUp:
        kind = data.get("kind", "note")
        text = (data.get("text") or "").strip()
        if kind == "promise":
            amt = data.get("promised_amount")
            if data.get("promised_date") is None or amt is None or Decimal(str(amt)) <= 0:
                raise ReceivablesValidationError("A promise needs a date and a positive amount")
        elif kind == "note":
            if not text:
                raise ReceivablesValidationError("A note needs some text")
        else:
            raise ReceivablesValidationError("kind must be note or promise")
        number = ""
        if data.get("invoice_id"):
            inv = await self.session.get(SalesDocument, data["invoice_id"])
            if inv is None or inv.tenant_id != self.tenant_id:
                raise ReceivablesNotFoundError("Invoice not found")
            number = inv.number
        promise = kind == "promise"
        row = ArFollowUp(
            tenant_id=self.tenant_id,
            partner_key=data["partner_key"],
            customer_name=data.get("customer_name") or "",
            kind=kind,
            text=text,
            invoice_id=data.get("invoice_id"),
            invoice_number=number,
            promised_date=data.get("promised_date") if promise else None,
            promised_amount=money(data["promised_amount"]) if promise else None,
            status="open" if promise else "",
            created_by=by,
        )
        self.session.add(row)
        await self.session.flush()
        return row

    async def _get(self, fid: uuid.UUID) -> ArFollowUp:
        row = await self.session.get(ArFollowUp, fid)
        if row is None or row.tenant_id != self.tenant_id:
            raise ReceivablesNotFoundError("Follow-up not found")
        return row

    async def set_status(self, fid: uuid.UUID, status: str) -> ArFollowUp:
        row = await self._get(fid)
        if row.kind != "promise":
            raise ReceivablesConflictError("Only promises have a status")
        if status not in PROMISE_STATUSES:
            raise ReceivablesValidationError("Unknown promise status")
        row.status = status
        await self.session.flush()
        return row

    async def delete(self, fid: uuid.UUID) -> None:
        await self.session.delete(await self._get(fid))
        await self.session.flush()
