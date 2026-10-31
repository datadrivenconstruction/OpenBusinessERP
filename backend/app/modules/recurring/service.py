"""Recurring invoice schedule math and idempotent generation."""

from __future__ import annotations

import calendar
import logging
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.gl.models import DEFAULT_TENANT
from app.modules.recurring.models import INTERVALS, RecurringInvoice, RecurringRun
from app.modules.sales.service import LineData, SalesError, SalesService, default_tax_rate, line_amounts

logger = logging.getLogger(__name__)

ZERO = Decimal(0)
MONTHS_PER = {"monthly": 1, "quarterly": 3, "yearly": 12}
# Catch-up cap per template and tick, so a long outage cannot flood the books in one go.
MAX_CATCH_UP = 24


class RecurringError(Exception):
    pass


class RecurringNotFoundError(RecurringError):
    pass


class RecurringValidationError(RecurringError):
    pass


class RecurringConflictError(RecurringError):
    pass


# ── Schedule math ─────────────────────────────────────────────────────────
def add_months(d: date, months: int, day: int | None = None) -> date:
    """``d`` shifted by ``months``; the day (default ``d.day``) is clamped to the target month's end."""
    m = d.month - 1 + months
    y, m = d.year + m // 12, m % 12 + 1
    return date(y, m, min(day or d.day, calendar.monthrange(y, m)[1]))


def occurrence(start: date, interval: str, interval_count: int, index: int, day_of_month: int | None = None) -> date:
    """Date of period ``index`` (0-based), always computed from ``start`` so month-end never drifts."""
    if interval not in INTERVALS:
        raise RecurringValidationError(f"Unknown interval {interval!r}")
    step = max(1, interval_count)
    if interval == "weekly":
        return start + timedelta(weeks=step * index)
    months = MONTHS_PER[interval] * step * index
    if day_of_month and day_of_month < start.day:
        months += 1  # the billing day already passed in the start month
    return add_months(start, months, day_of_month or start.day)


def _occ(t: RecurringInvoice, index: int) -> date:
    return occurrence(t.start_date, t.interval, t.interval_count, index, t.day_of_month)


def schedule_exhausted(t: RecurringInvoice, index: int) -> bool:
    if t.max_count is not None and index >= t.max_count:
        return True
    return t.end_date is not None and _occ(t, index) > t.end_date


def refresh_next_run(t: RecurringInvoice) -> None:
    if schedule_exhausted(t, t.period_index):
        t.next_run_date = None
        t.status = "ended"
    else:
        t.next_run_date = _occ(t, t.period_index)


def monthly_factor(interval: str, interval_count: int) -> Decimal:
    step = Decimal(max(1, interval_count))
    if interval == "weekly":
        return Decimal(52) / Decimal(12) / step
    return Decimal(1) / (MONTHS_PER[interval] * step)


# ── Lines ─────────────────────────────────────────────────────────────────
def _dec(v: Any, default: Decimal = ZERO) -> Decimal:
    if v is None or v == "":
        return default
    return Decimal(str(v))


def normalize_lines(lines: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Lines as JSON strings; a missing tax rate is fixed to the company default when saved."""
    fallback = default_tax_rate() if any(ln.get("tax_rate") in (None, "") for ln in lines) else ZERO
    return [
        {
            "description": str(ln.get("description") or "")[:500],
            "sku": str(ln.get("sku") or "")[:64],
            "qty": str(_dec(ln.get("qty"), Decimal(1))),
            "unit_price": str(_dec(ln.get("unit_price"))),
            "discount_pct": str(_dec(ln.get("discount_pct"))),
            "tax_rate": str(_dec(ln.get("tax_rate"), fallback)),
            "item_id": str(ln["item_id"]) if ln.get("item_id") else None,
        }
        for ln in lines
    ]


def line_data(lines: list[dict[str, Any]]) -> list[LineData]:
    return [
        LineData(
            description=ln["description"],
            sku=ln.get("sku") or "",
            qty=_dec(ln.get("qty"), Decimal(1)),
            unit_price=_dec(ln.get("unit_price")),
            discount_pct=_dec(ln.get("discount_pct")),
            tax_rate=_dec(ln.get("tax_rate")),
            item_id=uuid.UUID(ln["item_id"]) if ln.get("item_id") else None,
        )
        for ln in lines
    ]


def template_totals(lines: list[dict[str, Any]]) -> tuple[Decimal, Decimal]:
    net = gross = ZERO
    for ln in lines:
        n, _tax, g = line_amounts(ln["qty"], ln["unit_price"], ln["discount_pct"], ln["tax_rate"])
        net, gross = net + n, gross + g
    return net, gross


@dataclass
class GenerateResult:
    template_id: uuid.UUID
    period_date: date | None
    document_id: uuid.UUID | None
    status: str
    detail: str = ""


FIELDS = (
    "name",
    "customer_id",
    "customer_name",
    "customer_email",
    "customer_address",
    "currency",
    "notes",
    "interval",
    "interval_count",
    "start_date",
    "end_date",
    "max_count",
    "day_of_month",
    "payment_terms_days",
    "auto_issue",
    "auto_send",
)
SCHEDULE_FIELDS = ("interval", "interval_count", "start_date", "day_of_month", "end_date", "max_count")


class RecurringService:
    def __init__(self, session: AsyncSession, tenant_id: str = DEFAULT_TENANT) -> None:
        self.session = session
        self.tenant_id = tenant_id

    # ── CRUD ──────────────────────────────────────────────────────────────
    async def get(self, template_id: uuid.UUID, *, lock: bool = False) -> RecurringInvoice:
        q = select(RecurringInvoice).where(
            RecurringInvoice.id == template_id, RecurringInvoice.tenant_id == self.tenant_id
        )
        if lock:
            q = q.with_for_update()
        t = await self.session.scalar(q)
        if t is None:
            raise RecurringNotFoundError(f"Recurring invoice {template_id} not found")
        return t

    async def list_templates(self, status: str | None = None) -> list[RecurringInvoice]:
        q = select(RecurringInvoice).where(RecurringInvoice.tenant_id == self.tenant_id)
        if status:
            q = q.where(RecurringInvoice.status == status)
        q = q.order_by(RecurringInvoice.next_run_date.is_(None), RecurringInvoice.next_run_date, RecurringInvoice.name)
        return list((await self.session.execute(q)).scalars())

    @staticmethod
    def _validate(t: RecurringInvoice) -> None:
        if t.interval not in INTERVALS:
            raise RecurringValidationError(f"Interval must be one of {', '.join(INTERVALS)}")
        if not 1 <= (t.interval_count or 0) <= 36:
            raise RecurringValidationError("Interval count must be between 1 and 36")
        if t.day_of_month is not None and not 1 <= t.day_of_month <= 31:
            raise RecurringValidationError("Day of month must be between 1 and 31")
        if t.start_date is None:
            raise RecurringValidationError("Start date is required")
        if t.end_date is not None and t.end_date < t.start_date:
            raise RecurringValidationError("End date is before the start date")
        if t.max_count is not None and t.max_count < 1:
            raise RecurringValidationError("Number of invoices must be at least 1")
        if not (t.customer_name or "").strip():
            raise RecurringValidationError("Customer is required")
        if not t.lines:
            raise RecurringValidationError("At least one line is required")

    def _apply(self, t: RecurringInvoice, data: dict[str, Any], lines: list[dict[str, Any]] | None) -> None:
        for k in FIELDS:
            if k in data:
                setattr(t, k, data[k])
        t.currency = (t.currency or "EUR").upper()
        t.name = (t.name or t.customer_name or "").strip()
        if lines is not None:
            t.lines = normalize_lines(lines)
            t.net_total, t.gross_total = template_totals(t.lines)
        self._validate(t)

    async def create(
        self, *, lines: list[dict[str, Any]], created_by: str | None = None, tag: str = "", **data: Any
    ) -> RecurringInvoice:
        t = RecurringInvoice(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            status="active",
            interval="monthly",
            interval_count=1,
            payment_terms_days=14,
            auto_issue=True,
            auto_send=False,
            period_index=0,
            generated_count=0,
            notes="",
            customer_email="",
            customer_address="",
            last_error="",
            tag=tag,
            created_by=created_by,
        )
        self._apply(t, data, lines)
        refresh_next_run(t)
        self.session.add(t)
        await self.session.flush()
        return t

    async def update(
        self, template_id: uuid.UUID, *, lines: list[dict[str, Any]] | None = None, **data: Any
    ) -> RecurringInvoice:
        t = await self.get(template_id, lock=True)
        changed = any(k in data and data[k] != getattr(t, k) for k in SCHEDULE_FIELDS)
        self._apply(t, data, lines)
        if changed:
            if t.status == "ended":
                t.status = "active"
            await self._resync_index(t, date.today())
        await self.session.flush()
        return t

    async def _resync_index(self, t: RecurringInvoice, today: date) -> None:
        """Point at the first period that is not billed yet and not in the past (missed periods are skipped)."""
        done = set(
            (
                await self.session.execute(select(RecurringRun.period_date).where(RecurringRun.template_id == t.id))
            ).scalars()
        )
        idx = 0
        while idx < 5000 and not schedule_exhausted(t, idx):
            d = _occ(t, idx)
            if d not in done and d >= today:
                break
            idx += 1
        t.period_index = idx
        paused = t.status == "paused"
        refresh_next_run(t)
        if paused and t.status == "ended":
            t.status = "paused"

    async def delete(self, template_id: uuid.UUID) -> None:
        t = await self.get(template_id)
        await self.session.delete(t)
        await self.session.flush()

    async def pause(self, template_id: uuid.UUID) -> RecurringInvoice:
        t = await self.get(template_id, lock=True)
        if t.status != "active":
            raise RecurringConflictError(f"Only active recurring invoices can be paused (status {t.status})")
        t.status = "paused"
        await self.session.flush()
        return t

    async def resume(self, template_id: uuid.UUID, today: date | None = None) -> RecurringInvoice:
        t = await self.get(template_id, lock=True)
        if t.status != "paused":
            raise RecurringConflictError(f"Only paused recurring invoices can be resumed (status {t.status})")
        t.status = "active"
        await self._resync_index(t, today or date.today())
        await self.session.flush()
        return t

    async def runs(self, template_id: uuid.UUID) -> list[RecurringRun]:
        await self.get(template_id)
        q = (
            select(RecurringRun)
            .where(RecurringRun.template_id == template_id, RecurringRun.tenant_id == self.tenant_id)
            .order_by(RecurringRun.period_date.desc())
        )
        return list((await self.session.execute(q)).scalars())

    async def summary(self, today: date | None = None) -> dict[str, Any]:
        rows = await self.list_templates()
        mrr: dict[str, Decimal] = {}
        for t in rows:
            if t.status == "active":
                mrr[t.currency] = mrr.get(t.currency, ZERO) + (t.net_total or ZERO) * monthly_factor(
                    t.interval, t.interval_count
                )
        soon = (today or date.today()) + timedelta(days=7)
        cents = Decimal("0.01")
        return {
            "active": sum(1 for t in rows if t.status == "active"),
            "paused": sum(1 for t in rows if t.status == "paused"),
            "ended": sum(1 for t in rows if t.status == "ended"),
            "due_next_7_days": sum(
                1 for t in rows if t.status == "active" and t.next_run_date and t.next_run_date <= soon
            ),
            "mrr": {k: str(v.quantize(cents)) for k, v in sorted(mrr.items())},
            "arr": {k: str((v * 12).quantize(cents)) for k, v in sorted(mrr.items())},
        }

    # ── Generation ────────────────────────────────────────────────────────
    async def generate(
        self, template_id: uuid.UUID, *, trigger: str = "manual", created_by: str | None = None, email: Any = None
    ) -> GenerateResult:
        """Bill the template's next period now, due or not ("Generate now")."""
        t = await self.get(template_id, lock=True)
        if t.status != "active" or t.next_run_date is None:
            raise RecurringConflictError(f"Recurring invoice is {t.status}; nothing to generate")
        return await self._generate_period(t, trigger=trigger, created_by=created_by, email=email)

    async def run_due(self, today: date | None = None, *, email: Any = None) -> list[GenerateResult]:
        """Generate every due period for this tenant. Safe to run any number of times."""
        today = today or date.today()
        ids = list(
            (
                await self.session.execute(
                    select(RecurringInvoice.id).where(
                        RecurringInvoice.tenant_id == self.tenant_id,
                        RecurringInvoice.status == "active",
                        RecurringInvoice.next_run_date.is_not(None),
                        RecurringInvoice.next_run_date <= today,
                    )
                )
            ).scalars()
        )
        results: list[GenerateResult] = []
        for tid in ids:
            for _ in range(MAX_CATCH_UP):
                t = await self.get(tid, lock=True)
                if t.status != "active" or t.next_run_date is None or t.next_run_date > today:
                    break
                res = await self._generate_period(t, trigger="schedule", created_by=t.created_by, email=email)
                results.append(res)
                if res.status == "failed":
                    break
        return results

    async def _generate_period(
        self, t: RecurringInvoice, *, trigger: str, created_by: str | None, email: Any
    ) -> GenerateResult:
        period = t.next_run_date
        assert period is not None
        existing = await self.session.scalar(
            select(RecurringRun).where(RecurringRun.template_id == t.id, RecurringRun.period_date == period)
        )
        if existing is not None:
            self._advance(t)
            await self.session.flush()
            return GenerateResult(t.id, period, existing.document_id, "skipped", "already generated")
        period_end = _occ(t, t.period_index + 1) - timedelta(days=1)
        sales = SalesService(self.session, self.tenant_id)
        run = RecurringRun(
            id=uuid.uuid4(),
            tenant_id=self.tenant_id,
            template_id=t.id,
            period_date=period,
            trigger=trigger,
            status="generated",
            detail="",
            document_number="",
            gross_total=ZERO,
        )
        try:
            async with self.session.begin_nested():
                self.session.add(run)
                await self.session.flush()  # unique (template, period) trips here on a race
                doc = await sales.create(
                    "invoice",
                    lines=line_data(t.lines),
                    doc_date=period,
                    due_date=period + timedelta(days=max(0, t.payment_terms_days)),
                    created_by=created_by,
                    customer_id=t.customer_id,
                    customer_name=t.customer_name,
                    customer_email=t.customer_email or None,
                    customer_address=t.customer_address or None,
                    currency=t.currency,
                    delivery_date=period,
                    delivery_end=period_end if period_end >= period else None,
                    notes="\n".join(p for p in (t.notes, f"{t.name}: {period:%Y-%m-%d} - {period_end:%Y-%m-%d}") if p),
                )
                if t.auto_issue:
                    await sales.issue_invoice(doc.id, created_by=created_by)
                    run.status = "issued"
                run.document_id, run.document_number, run.gross_total = doc.id, doc.number, doc.gross_total
                await self.session.flush()
        except IntegrityError:
            await self.session.refresh(t)
            self._advance(t)
            await self.session.flush()
            return GenerateResult(t.id, period, None, "skipped", "already generated")
        except SalesError as exc:
            t.last_error = str(exc)[:255]
            t.last_run_at = datetime.now(UTC)
            await self.session.flush()
            logger.warning("Recurring invoice %s period %s failed: %s", t.id, period, exc)
            return GenerateResult(t.id, period, None, "failed", str(exc))

        t.generated_count += 1
        t.last_document_id = doc.id
        t.last_run_at = datetime.now(UTC)
        t.last_error = ""
        self._advance(t)
        await self.session.flush()
        if t.auto_send and run.status == "issued":
            await self._send(doc, run, created_by, email)
        return GenerateResult(t.id, period, doc.id, run.status, run.detail)

    def _advance(self, t: RecurringInvoice) -> None:
        t.period_index += 1
        refresh_next_run(t)

    async def _send(self, doc: Any, run: RecurringRun, sent_by: str | None, email: Any) -> None:
        try:
            from app.modules.sales.documents import service as docs
        except ImportError:  # no send pipeline: the invoice stays issued and unsent
            return
        if not doc.customer_email:
            run.detail = "No customer e-mail; not sent"
            await self.session.flush()
            return
        if email is None:
            from app.core.mail_settings import mail_service, mail_status

            if not mail_status()["configured"]:
                run.detail = "Mail is not configured; not sent"
                await self.session.flush()
                return
            email = mail_service()
        try:
            draft = docs.email_draft(doc, docs.company_data())
            log = await docs.send_document(
                self.session,
                doc,
                to=doc.customer_email,
                cc=[],
                subject=draft["subject"],
                body=draft["body"],
                sent_by=sent_by,
                email=email,
            )
            run.status = "sent" if log.status == "sent" else "send_failed"
            run.detail = (log.detail or "")[:255]
        except Exception as exc:  # noqa: BLE001 - a failed mail never undoes the posted invoice
            logger.warning("Recurring invoice send failed for %s: %s", doc.number, exc)
            run.status, run.detail = "send_failed", str(exc)[:255]
        await self.session.flush()


async def due_tenants(session: AsyncSession, today: date) -> list[str]:
    q = (
        select(RecurringInvoice.tenant_id)
        .where(
            RecurringInvoice.status == "active",
            RecurringInvoice.next_run_date.is_not(None),
            RecurringInvoice.next_run_date <= today,
        )
        .group_by(RecurringInvoice.tenant_id)
    )
    return list((await session.execute(q)).scalars())
