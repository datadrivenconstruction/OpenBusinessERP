"""Receivables: aging, dunning levels and runs, customer block list, statement PDF.

Dunning runs only produce drafts. Mail leaves only when a user sends a draft
(``send_letter``), with the invoice PDF attached; letters are delivered by hand. Fees and interest are
off by default and computed only when switched on in the settings.
"""

from __future__ import annotations

import io
import uuid
from collections import defaultdict
from datetime import UTC, date, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_settings import read_business_settings
from app.modules.banking.service import partner_key
from app.modules.gl.models import DEFAULT_TENANT
from app.modules.gl.service import base_currency
from app.modules.receivables.models import (
    DunningBlock,
    DunningLetter,
    DunningLevel,
    DunningRun,
    DunningSettings,
)
from app.modules.sales.models import SalesDocument

ZERO = Decimal(0)
CENT = Decimal("0.01")
BUCKETS = ("current", "d1_30", "d31_60", "d61_90", "d90_plus")
OPEN_STATUSES = ("issued", "partially_paid")
# Reference only, never applied automatically: the German statutory default
# (§288 BGB) is the base rate plus 5 or 9 points; the user enters the rate.
INTEREST_RATE_HINT = "base rate + 5 (consumers) / + 9 (businesses) percentage points"

PLACEHOLDERS = (
    "customer",
    "number",
    "doc_date",
    "due_date",
    "outstanding",
    "currency",
    "days_overdue",
    "fee",
    "interest",
    "total",
)

DEFAULT_LEVELS: dict[str, list[tuple[int, str, int, str, str]]] = {
    "en": [
        (
            1,
            "Reminder",
            7,
            "Payment reminder for invoice {number}",
            "Hello {customer},\n\nour records show that invoice {number} dated {doc_date} "
            "(due {due_date}) still has an open balance of {outstanding} {currency}. "
            "This may simply have been overlooked.\n\nWe would appreciate payment at your convenience. "
            "If you have already paid, please disregard this note.\n\nKind regards",
        ),
        (
            2,
            "First notice",
            21,
            "Open balance on invoice {number}",
            "Hello {customer},\n\ninvoice {number} (due {due_date}) is now {days_overdue} days past due "
            "with {outstanding} {currency} outstanding.\n\nPlease arrange payment of {total} {currency} "
            "within the next 10 days, or let us know if there is a question about the invoice.\n\nKind regards",
        ),
        (
            3,
            "Second notice",
            35,
            "Second notice: invoice {number}",
            "Hello {customer},\n\ndespite our earlier messages, invoice {number} (due {due_date}) remains unpaid "
            "with {outstanding} {currency} open.\n\nWe ask you to settle {total} {currency} within 7 days. "
            "If something stands in the way, please contact us so we can find a solution together.\n\nKind regards",
        ),
    ],
    "de": [
        (
            1,
            "Zahlungserinnerung",
            7,
            "Zahlungserinnerung zur Rechnung {number}",
            "Guten Tag {customer},\n\nfür die Rechnung {number} vom {doc_date} (fällig am {due_date}) ist bei uns "
            "noch ein Betrag von {outstanding} {currency} offen. Vielleicht ist die Zahlung einfach untergegangen.\n\n"
            "Wir freuen uns über einen Ausgleich in den nächsten Tagen. Falls Sie bereits gezahlt haben, "
            "betrachten Sie diese Nachricht bitte als gegenstandslos.\n\nFreundliche Grüße",
        ),
        (
            2,
            "1. Mahnung",
            21,
            "Offener Betrag zur Rechnung {number}",
            "Guten Tag {customer},\n\ndie Rechnung {number} (fällig am {due_date}) ist seit {days_overdue} Tagen "
            "überfällig; offen sind {outstanding} {currency}.\n\nBitte überweisen Sie {total} {currency} innerhalb "
            "von 10 Tagen oder sprechen Sie uns an, falls es Fragen zur Rechnung gibt.\n\nFreundliche Grüße",
        ),
        (
            3,
            "2. Mahnung",
            35,
            "2. Mahnung zur Rechnung {number}",
            "Guten Tag {customer},\n\ntrotz unserer bisherigen Schreiben ist die Rechnung {number} "
            "(fällig am {due_date}) mit {outstanding} {currency} weiterhin offen.\n\nBitte gleichen Sie {total} "
            "{currency} innerhalb von 7 Tagen aus. Wenn etwas dagegen spricht, melden Sie sich gern, damit wir "
            "gemeinsam eine Lösung finden.\n\nFreundliche Grüße",
        ),
    ],
}


class ReceivablesError(Exception):
    pass


class ReceivablesNotFoundError(ReceivablesError):
    pass


class ReceivablesValidationError(ReceivablesError):
    pass


class ReceivablesConflictError(ReceivablesError):
    pass


def money(v: Any) -> Decimal:
    return Decimal(str(v)).quantize(CENT, rounding=ROUND_HALF_UP)


def bucket_for(days_overdue: int) -> str:
    if days_overdue <= 0:
        return "current"
    if days_overdue <= 30:
        return "d1_30"
    if days_overdue <= 60:
        return "d31_60"
    if days_overdue <= 90:
        return "d61_90"
    return "d90_plus"


def next_level(levels: list[DunningLevel], current: int, days_overdue: int) -> DunningLevel | None:
    """Highest level above ``current`` that is due, stepping one level per run."""
    due = [
        lv for lv in sorted(levels, key=lambda x: x.level) if lv.level > current and days_overdue >= lv.days_after_due
    ]
    return due[0] if due else None


def render(template: str, values: dict[str, Any]) -> str:
    class _Safe(dict):
        def __missing__(self, key: str) -> str:
            return "{" + key + "}"

    return template.format_map(_Safe(values))


def _lang() -> str:
    cc = str(read_business_settings().get("country_code") or "").upper()
    return "de" if cc in {"DE", "AT", "CH", "LI", "LU"} else "en"


class ReceivablesService:
    def __init__(self, session: AsyncSession, tenant_id: str = DEFAULT_TENANT) -> None:
        self.session = session
        self.tenant_id = tenant_id

    async def _open_invoices(self) -> list[SalesDocument]:
        D = SalesDocument
        q = select(D).where(D.tenant_id == self.tenant_id, D.kind == "invoice", D.status.in_(OPEN_STATUSES))
        return list((await self.session.execute(q.order_by(D.due_date, D.number))).scalars())

    # ── Aging ─────────────────────────────────────────────────────────────
    async def aging(self, as_of: date | None = None) -> dict[str, Any]:
        as_of = as_of or date.today()
        rows: dict[str, dict[str, Any]] = {}
        totals = defaultdict(lambda: ZERO)
        for inv in await self._open_invoices():
            key = partner_key(inv.customer_id, inv.customer_name)
            open_amt = money((inv.gross_total - inv.amount_paid) * (inv.fx_rate or 1))  # base, per invoice
            days = (as_of - (inv.due_date or inv.doc_date)).days
            r = rows.setdefault(
                key,
                {
                    "partner_key": key,
                    "customer_id": inv.customer_id,
                    "customer_name": inv.customer_name,
                    **dict.fromkeys(BUCKETS, ZERO),
                    "total": ZERO,
                    "invoices": [],
                },
            )
            b = bucket_for(days)
            r[b] += open_amt
            r["total"] += open_amt
            totals[b] += open_amt
            totals["total"] += open_amt
            r["invoices"].append(
                {
                    "id": inv.id,
                    "number": inv.number,
                    "doc_date": inv.doc_date,
                    "due_date": inv.due_date,
                    "open": money(inv.gross_total - inv.amount_paid),
                    "currency": inv.currency,
                    "fx_rate": inv.fx_rate,
                    "open_base": open_amt,
                    "days_overdue": max(days, 0),
                    "bucket": b,
                }
            )
        out = sorted(rows.values(), key=lambda r: -r["total"])
        for r in out:
            for k in (*BUCKETS, "total"):
                r[k] = money(r[k])
        return {
            "as_of": as_of,
            "base_currency": base_currency(),
            "rows": out,
            "totals": {k: money(totals[k]) for k in (*BUCKETS, "total")},
        }

    # ── Settings & levels ─────────────────────────────────────────────────
    async def settings(self) -> DunningSettings:
        row = await self.session.scalar(select(DunningSettings).where(DunningSettings.tenant_id == self.tenant_id))
        if row is None:
            row = DunningSettings(
                tenant_id=self.tenant_id,
                fees_enabled=False,
                interest_enabled=False,
                interest_rate_pct=ZERO,
                min_days_between=7,
            )
            self.session.add(row)
            await self.session.flush()
        return row

    async def update_settings(self, **data: Any) -> DunningSettings:
        row = await self.settings()
        for k in ("fees_enabled", "interest_enabled", "interest_rate_pct", "min_days_between"):
            if data.get(k) is not None:
                setattr(row, k, data[k])
        await self.session.flush()
        return row

    async def levels(self) -> list[DunningLevel]:
        q = select(DunningLevel).where(DunningLevel.tenant_id == self.tenant_id).order_by(DunningLevel.level)
        rows = list((await self.session.execute(q)).scalars())
        if not rows:
            for lv, name, days, subject, body in DEFAULT_LEVELS[_lang()]:
                row = DunningLevel(
                    tenant_id=self.tenant_id,
                    level=lv,
                    name=name,
                    days_after_due=days,
                    fee=ZERO,
                    subject=subject,
                    body=body,
                )
                self.session.add(row)
                rows.append(row)
            await self.session.flush()
        return rows

    async def set_levels(self, levels: list[dict[str, Any]]) -> list[DunningLevel]:
        nums = [lv["level"] for lv in levels]
        if len(set(nums)) != len(nums) or not levels:
            raise ReceivablesValidationError("Levels must be unique and at least one is needed")
        ordered = sorted(levels, key=lambda x: x["level"])
        if any(a["days_after_due"] >= b["days_after_due"] for a, b in zip(ordered, ordered[1:], strict=False)):
            raise ReceivablesValidationError("Each level needs more days after due than the previous one")
        existing = {lv.level: lv for lv in await self.levels()}
        for lv in levels:
            row = existing.pop(lv["level"], None) or DunningLevel(tenant_id=self.tenant_id, level=lv["level"])
            for k in ("name", "days_after_due", "fee", "subject", "body"):
                setattr(row, k, lv[k])
            self.session.add(row)
        for row in existing.values():
            await self.session.delete(row)
        await self.session.flush()
        return await self.levels()

    # ── Block list ────────────────────────────────────────────────────────
    async def blocks(self) -> list[DunningBlock]:
        q = select(DunningBlock).where(DunningBlock.tenant_id == self.tenant_id).order_by(DunningBlock.customer_name)
        return list((await self.session.execute(q)).scalars())

    async def block(self, key: str, customer_name: str = "", reason: str = "", by: str | None = None) -> DunningBlock:
        row = await self.session.scalar(
            select(DunningBlock).where(DunningBlock.tenant_id == self.tenant_id, DunningBlock.partner_key == key)
        )
        if row is None:
            row = DunningBlock(tenant_id=self.tenant_id, partner_key=key, customer_name=customer_name, created_by=by)
            self.session.add(row)
        row.reason = reason
        await self.session.flush()
        return row

    async def unblock(self, block_id: uuid.UUID) -> None:
        row = await self.session.get(DunningBlock, block_id)
        if row is None or row.tenant_id != self.tenant_id:
            raise ReceivablesNotFoundError("Block entry not found")
        await self.session.delete(row)
        await self.session.flush()

    # ── Runs ──────────────────────────────────────────────────────────────
    async def _letters(self, *statuses: str) -> list[DunningLetter]:
        q = select(DunningLetter).where(DunningLetter.tenant_id == self.tenant_id, DunningLetter.status.in_(statuses))
        return list((await self.session.execute(q)).scalars())

    async def propose_run(self, as_of: date | None = None, created_by: str | None = None) -> DunningRun:
        """Create draft letters for every overdue, unblocked invoice that reached its next level."""
        as_of = as_of or date.today()
        run = DunningRun(tenant_id=self.tenant_id, run_date=as_of, created_by=created_by)
        run.letters = await self._proposals(as_of)
        self.session.add(run)
        await self.session.flush()
        return run

    async def preview_run(self, as_of: date | None = None, key: str | None = None) -> list[dict[str, Any]]:
        """What a run would draft today, without storing anything."""
        out = []
        for lt in await self._proposals(as_of or date.today()):
            if key and lt.partner_key != key:
                continue
            out.append(
                {
                    k: getattr(lt, k)
                    for k in (
                        "invoice_id",
                        "invoice_number",
                        "partner_key",
                        "customer_name",
                        "level",
                        "letter_date",
                        "days_overdue",
                        "currency",
                        "outstanding",
                        "fee",
                        "interest",
                        "subject",
                        "body",
                    )
                }
            )
        return out

    async def _proposals(self, as_of: date) -> list[DunningLetter]:
        cfg = await self.settings()
        levels = await self.levels()
        blocked = {b.partner_key for b in await self.blocks()}
        reached: dict[uuid.UUID, tuple[int, date]] = {}
        for lt in await self._letters("approved"):
            when = lt.letter_date
            cur = reached.get(lt.invoice_id)
            if cur is None or lt.level > cur[0]:
                reached[lt.invoice_id] = (lt.level, when)
        pending = {lt.invoice_id for lt in await self._letters("draft")}
        letters: list[DunningLetter] = []
        for inv in await self._open_invoices():
            key = partner_key(inv.customer_id, inv.customer_name)
            if key in blocked or inv.id in pending:
                continue
            days = (as_of - (inv.due_date or inv.doc_date)).days
            if days <= 0:
                continue
            current, last = reached.get(inv.id, (0, None))
            if last is not None and (as_of - last).days < cfg.min_days_between:
                continue
            lv = next_level(levels, current, days)
            if lv is None:
                continue
            outstanding = inv.gross_total - inv.amount_paid
            fee = money(lv.fee) if cfg.fees_enabled else ZERO
            interest = (
                money(outstanding * cfg.interest_rate_pct / 100 * days / 365)
                if cfg.interest_enabled and cfg.interest_rate_pct > 0
                else ZERO
            )
            values = {
                "customer": inv.customer_name or "",
                "number": inv.number,
                "doc_date": inv.doc_date.isoformat(),
                "due_date": (inv.due_date or inv.doc_date).isoformat(),
                "outstanding": f"{outstanding:.2f}",
                "currency": inv.currency,
                "days_overdue": days,
                "fee": f"{fee:.2f}",
                "interest": f"{interest:.2f}",
                "total": f"{outstanding + fee + interest:.2f}",
            }
            body = render(lv.body, values)
            if fee or interest:
                body += f"\n\n{lv.name}: fee {fee:.2f} {inv.currency}, interest {interest:.2f} {inv.currency}."
            letters.append(
                DunningLetter(
                    tenant_id=self.tenant_id,
                    invoice_id=inv.id,
                    invoice_number=inv.number,
                    partner_key=key,
                    customer_name=inv.customer_name,
                    level=lv.level,
                    letter_date=as_of,
                    days_overdue=days,
                    currency=inv.currency,
                    outstanding=outstanding,
                    fee=fee,
                    interest=interest,
                    channel="letter",
                    subject=render(lv.subject, values),
                    body=body,
                    status="draft",
                )
            )
        return letters

    async def list_runs(self, limit: int = 50) -> list[DunningRun]:
        q = select(DunningRun).where(DunningRun.tenant_id == self.tenant_id)
        return list((await self.session.execute(q.order_by(DunningRun.created_at.desc()).limit(limit))).scalars())

    async def get_run(self, run_id: uuid.UUID) -> DunningRun:
        run = await self.session.get(DunningRun, run_id)
        if run is None or run.tenant_id != self.tenant_id:
            raise ReceivablesNotFoundError("Dunning run not found")
        return run

    async def get_letter(self, letter_id: uuid.UUID) -> DunningLetter:
        lt = await self.session.get(DunningLetter, letter_id)
        if lt is None or lt.tenant_id != self.tenant_id:
            raise ReceivablesNotFoundError("Dunning letter not found")
        return lt

    async def update_letter(self, letter_id: uuid.UUID, **data: Any) -> DunningLetter:
        lt = await self.get_letter(letter_id)
        if lt.status != "draft":
            raise ReceivablesConflictError("Only drafts can be edited")
        for k in ("subject", "body", "channel"):
            if data.get(k) is not None:
                setattr(lt, k, data[k])
        await self.session.flush()
        return lt

    async def decide(self, letter_id: uuid.UUID, decision: str, by: str | None = None) -> DunningLetter:
        """Approve or discard a draft. Approval does not deliver anything."""
        if decision not in ("approved", "discarded"):
            raise ReceivablesValidationError("decision must be approved or discarded")
        lt = await self.get_letter(letter_id)
        if lt.status != "draft":
            raise ReceivablesConflictError(f"Letter is already {lt.status}")
        lt.status = decision
        lt.decided_by = by
        lt.decided_at = datetime.now(UTC)
        await self.session.flush()
        return lt

    async def send_letter(
        self,
        letter_id: uuid.UUID,
        *,
        email: Any,
        to: str | None = None,
        cc: list[str] | None = None,
        by: str | None = None,
    ) -> tuple[DunningLetter, Any]:
        """E-mail a draft or approved reminder with the invoice PDF; marks it sent on success."""
        from app.core.email.base import EmailAttachment, EmailMessage
        from app.modules.sales.documents import service as docs
        from app.modules.sales.models import SalesSendLog

        lt = await self.get_letter(letter_id)
        if lt.status not in ("draft", "approved"):
            raise ReceivablesConflictError(f"Letter is already {lt.status}")
        inv = await self.session.get(SalesDocument, lt.invoice_id)
        if inv is None or inv.tenant_id != self.tenant_id:
            raise ReceivablesNotFoundError("Invoice of this letter not found")
        try:
            recipients = docs._validate([to or inv.customer_email, *(cc or [])])
        except docs.SendRefusedError as exc:
            raise ReceivablesValidationError(str(exc)) from exc
        company = docs.company_data()
        pdf = await docs.render_pdf(self.session, inv, company)
        result = await email.send(
            EmailMessage(
                to=recipients[0],
                cc=recipients[1:],
                subject=lt.subject,
                html_body=docs.html_paragraphs(lt.body),
                reply_to=company.get("email") or None,
                tags=["dunning", f"level_{lt.level}"],
                attachments=[EmailAttachment(filename=docs.filename(inv), content=pdf)],
            )
        )
        now = datetime.now(UTC)
        if result.ok:
            lt.status = "sent"
            lt.channel = "email"
            lt.sent_at = now
            lt.sent_to = recipients[0][:255]
            lt.decided_by = lt.decided_by or by
            lt.decided_at = lt.decided_at or now
        self.session.add(
            SalesSendLog(
                id=uuid.uuid4(),
                tenant_id=self.tenant_id,
                document_id=inv.id,
                sent_by=by,
                sent_at=now,
                to_addr=recipients[0],
                cc=recipients[1:],
                subject=lt.subject[:255],
                status="sent" if result.ok else "failed",
                detail="" if result.ok else result.reason[:255],
                backend=result.backend,
            )
        )
        await self.session.flush()
        return lt, result

    async def history(self, key: str | None = None) -> list[DunningLetter]:
        q = select(DunningLetter).where(
            DunningLetter.tenant_id == self.tenant_id, DunningLetter.status.in_(("approved", "sent"))
        )
        if key:
            q = q.where(DunningLetter.partner_key == key)
        return list((await self.session.execute(q.order_by(DunningLetter.decided_at.desc()))).scalars())

    # ── Customer statement PDF ────────────────────────────────────────────
    async def statement_pdf(self, key: str, as_of: date | None = None) -> bytes:
        aging = await self.aging(as_of)
        row = next((r for r in aging["rows"] if r["partner_key"] == key), None)
        if row is None:
            raise ReceivablesNotFoundError("No open items for this customer")
        from reportlab.lib.pagesizes import A4
        from reportlab.pdfgen import canvas

        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=A4)
        w, h = A4
        y = h - 60
        company = str(read_business_settings().get("company_name") or "")
        c.setFont("Helvetica-Bold", 14)
        c.drawString(50, y, "Statement of account")
        c.setFont("Helvetica", 10)
        y -= 18
        if company:
            c.drawString(50, y, company)
            y -= 14
        c.drawString(50, y, f"Customer: {row['customer_name']}")
        y -= 14
        c.drawString(50, y, f"As of: {aging['as_of'].isoformat()}")
        y -= 28
        c.setFont("Helvetica-Bold", 10)
        for x, label in ((50, "Invoice"), (170, "Date"), (260, "Due"), (350, "Days overdue"), (470, "Open")):
            c.drawString(x, y, label)
        c.setFont("Helvetica", 10)
        for inv in row["invoices"]:
            y -= 16
            if y < 60:
                c.showPage()
                c.setFont("Helvetica", 10)
                y = h - 60
            c.drawString(50, y, inv["number"])
            c.drawString(170, y, inv["doc_date"].isoformat())
            c.drawString(260, y, inv["due_date"].isoformat() if inv["due_date"] else "")
            c.drawString(350, y, str(inv["days_overdue"]))
            c.drawRightString(w - 50, y, f"{inv['open']:.2f} {inv['currency']}")
        y -= 24
        c.setFont("Helvetica-Bold", 10)
        c.drawString(350, y, "Total open")
        c.drawRightString(w - 50, y, f"{row['total']:.2f}")
        c.showPage()
        c.save()
        return buf.getvalue()
