# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""General Ledger service: invariants live here, not in the router.

* posted entries are immutable; corrections go through :meth:`reverse_entry`;
* an entry balances in base currency (Decimal, 2 dp) before it may post;
* nothing posts into a closed period;
* posted entries are numbered gap-free per fiscal year (row lock on the year).
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.business_settings import read_business_settings
from app.modules.gl.models import (
    ACCOUNT_TYPES,
    DEFAULT_TENANT,
    ENTRY_DRAFT,
    ENTRY_POSTED,
    ENTRY_REVERSED,
    PERIOD_CLOSED,
    PERIOD_OPEN,
    GLAccount,
    GLFiscalYear,
    GLJournalEntry,
    GLJournalLine,
    GLPeriod,
)
from app.modules.gl.templates import TEMPLATES

CENT = Decimal("0.01")
ZERO = Decimal(0)
DEBIT_NORMAL = frozenset({"asset", "expense"})
LEDGER_STATUSES = (ENTRY_POSTED, ENTRY_REVERSED)


class GLError(Exception):
    """Base GL error."""


class GLNotFoundError(GLError):
    pass


class GLValidationError(GLError):
    pass


class GLConflictError(GLError):
    """Operation conflicts with state: posted entry, closed period."""


def money(value: Any) -> Decimal:
    return Decimal(str(value)).quantize(CENT, rounding=ROUND_HALF_UP)


def base_currency() -> str:
    return str(read_business_settings().get("base_currency") or "EUR").upper()


def natural_balance(account_type: str, debit: Decimal, credit: Decimal) -> Decimal:
    """Balance in the account's natural sign (debit-normal for assets/expenses)."""
    return debit - credit if account_type in DEBIT_NORMAL else credit - debit


@dataclass
class LineInput:
    account_id: uuid.UUID
    debit: Decimal = ZERO
    credit: Decimal = ZERO
    description: str = ""
    tax_code: str | None = None
    cost_center: str | None = None
    project_id: uuid.UUID | None = None


def build_lines(lines: list[LineInput], fx_rate: Decimal, tenant_id: str = DEFAULT_TENANT) -> list[GLJournalLine]:
    """Validate line shape and convert to base currency."""
    if len(lines) < 2:
        raise GLValidationError("An entry needs at least two lines")
    out: list[GLJournalLine] = []
    for i, ln in enumerate(lines, start=1):
        debit, credit = money(ln.debit or 0), money(ln.credit or 0)
        if debit < 0 or credit < 0:
            raise GLValidationError(f"Line {i}: negative amount")
        if (debit > 0) == (credit > 0):
            raise GLValidationError(f"Line {i}: exactly one of debit or credit must be non-zero")
        out.append(
            GLJournalLine(
                tenant_id=tenant_id,
                line_no=i,
                account_id=ln.account_id,
                description=ln.description or "",
                debit=debit,
                credit=credit,
                base_debit=money(debit * fx_rate),
                base_credit=money(credit * fx_rate),
                tax_code=ln.tax_code,
                cost_center=ln.cost_center,
                project_id=ln.project_id,
            )
        )
    return out


def check_balanced(lines: list[GLJournalLine]) -> None:
    dr = sum((ln.base_debit for ln in lines), ZERO)
    cr = sum((ln.base_credit for ln in lines), ZERO)
    if dr != cr:
        raise GLValidationError(f"Entry does not balance in base currency: debit {dr} != credit {cr}")


def _month_end(d: date) -> date:
    nxt = date(d.year + (d.month == 12), d.month % 12 + 1, 1)
    return nxt - timedelta(days=1)


class GLService:
    def __init__(self, session: AsyncSession, tenant_id: str = DEFAULT_TENANT) -> None:
        self.session = session
        self.tenant_id = tenant_id

    async def _own(self, model: Any, obj_id: uuid.UUID) -> Any:
        """Fetch by id within this tenant; other tenants' rows look absent."""
        obj = await self.session.get(model, obj_id)
        return obj if obj is not None and obj.tenant_id == self.tenant_id else None

    # ── Accounts ──────────────────────────────────────────────────────────
    async def list_accounts(self, *, active_only: bool = False) -> list[GLAccount]:
        stmt = select(GLAccount).where(GLAccount.tenant_id == self.tenant_id).order_by(GLAccount.code)
        if active_only:
            stmt = stmt.where(GLAccount.active.is_(True))
        return list((await self.session.execute(stmt)).scalars())

    async def get_account(self, account_id: uuid.UUID) -> GLAccount:
        acc = await self._own(GLAccount, account_id)
        if acc is None:
            raise GLNotFoundError(f"Account {account_id} not found")
        return acc

    async def create_account(self, **data: Any) -> GLAccount:
        if data.get("account_type") not in ACCOUNT_TYPES:
            raise GLValidationError(f"account_type must be one of {ACCOUNT_TYPES}")
        exists = await self.session.scalar(
            select(GLAccount.id).where(GLAccount.tenant_id == self.tenant_id, GLAccount.code == data["code"])
        )
        if exists:
            raise GLConflictError(f"Account code {data['code']} already exists")
        acc = GLAccount(**data, tenant_id=self.tenant_id)
        self.session.add(acc)
        await self.session.flush()
        return acc

    async def update_account(self, account_id: uuid.UUID, **data: Any) -> GLAccount:
        acc = await self.get_account(account_id)
        if "account_type" in data and data["account_type"] not in ACCOUNT_TYPES:
            raise GLValidationError(f"account_type must be one of {ACCOUNT_TYPES}")
        for k, v in data.items():
            setattr(acc, k, v)
        await self.session.flush()
        return acc

    async def load_template(self, key: str) -> dict[str, int]:
        """Insert template accounts; existing codes are skipped (idempotent)."""
        rows = TEMPLATES.get(key)
        if rows is None:
            raise GLNotFoundError(f"Unknown template {key!r}; available: {sorted(TEMPLATES)}")
        existing = {a.code: a for a in await self.list_accounts()}
        created = 0
        for code, name, typ, parent_code, postable in rows:
            if code in existing:
                continue
            parent = existing.get(parent_code) if parent_code else None
            acc = GLAccount(
                code=code,
                name=name,
                account_type=typ,
                parent_id=parent.id if parent else None,
                is_postable=postable,
                active=True,
                template=key,
                tenant_id=self.tenant_id,
            )
            self.session.add(acc)
            await self.session.flush()
            existing[code] = acc
            created += 1
        return {"created": created, "skipped": len(rows) - created}

    # ── Fiscal years / periods ────────────────────────────────────────────
    async def create_fiscal_year(self, name: str, start_date: date, end_date: date) -> GLFiscalYear:
        if end_date <= start_date:
            raise GLValidationError("end_date must be after start_date")
        overlap = await self.session.scalar(
            select(GLFiscalYear.id).where(
                GLFiscalYear.tenant_id == self.tenant_id,
                GLFiscalYear.start_date <= end_date,
                GLFiscalYear.end_date >= start_date,
            )
        )
        if overlap:
            raise GLConflictError("Fiscal year overlaps an existing one")
        fy = GLFiscalYear(
            tenant_id=self.tenant_id,
            name=name,
            start_date=start_date,
            end_date=end_date,
            status=PERIOD_OPEN,
            last_number=0,
        )
        cur, n = start_date, 1
        while cur <= end_date:
            end = min(_month_end(cur), end_date)
            fy.periods.append(
                GLPeriod(
                    tenant_id=self.tenant_id, name=f"{name}-{n:02d}", start_date=cur, end_date=end, status=PERIOD_OPEN
                )
            )
            cur, n = end + timedelta(days=1), n + 1
        self.session.add(fy)
        await self.session.flush()
        return fy

    async def list_fiscal_years(self) -> list[GLFiscalYear]:
        return list(
            (
                await self.session.execute(
                    select(GLFiscalYear)
                    .where(GLFiscalYear.tenant_id == self.tenant_id)
                    .order_by(GLFiscalYear.start_date)
                )
            ).scalars()
        )

    async def set_period_status(self, period_id: uuid.UUID, status: str) -> GLPeriod:
        if status not in (PERIOD_OPEN, PERIOD_CLOSED):
            raise GLValidationError("status must be open or closed")
        period = await self._own(GLPeriod, period_id)
        if period is None:
            raise GLNotFoundError(f"Period {period_id} not found")
        period.status = status
        await self.session.flush()
        return period

    async def period_for(self, on: date) -> GLPeriod:
        period = await self.session.scalar(
            select(GLPeriod).where(
                GLPeriod.tenant_id == self.tenant_id, GLPeriod.start_date <= on, GLPeriod.end_date >= on
            )
        )
        if period is None:
            raise GLValidationError(f"No accounting period covers {on}")
        return period

    # ── Journal entries ───────────────────────────────────────────────────
    async def get_entry(self, entry_id: uuid.UUID) -> GLJournalEntry:
        entry = await self._own(GLJournalEntry, entry_id)
        if entry is None:
            raise GLNotFoundError(f"Journal entry {entry_id} not found")
        return entry

    async def list_entries(
        self,
        *,
        status: str | None = None,
        date_from: date | None = None,
        date_to: date | None = None,
        source_type: str | None = None,
        source_id: str | None = None,
        limit: int = 200,
        offset: int = 0,
    ) -> list[GLJournalEntry]:
        stmt = (
            select(GLJournalEntry)
            .where(GLJournalEntry.tenant_id == self.tenant_id)
            .order_by(GLJournalEntry.entry_date, GLJournalEntry.seq)
        )
        if status:
            stmt = stmt.where(GLJournalEntry.status == status)
        if date_from:
            stmt = stmt.where(GLJournalEntry.entry_date >= date_from)
        if date_to:
            stmt = stmt.where(GLJournalEntry.entry_date <= date_to)
        if source_type:
            stmt = stmt.where(GLJournalEntry.source_type == source_type)
        if source_id:
            stmt = stmt.where(GLJournalEntry.source_id == source_id)
        return list((await self.session.execute(stmt.limit(limit).offset(offset))).scalars())

    async def _check_accounts(self, lines: list[LineInput]) -> None:
        ids = {ln.account_id for ln in lines}
        accs = {
            a.id: a
            for a in (
                await self.session.execute(
                    select(GLAccount).where(GLAccount.tenant_id == self.tenant_id, GLAccount.id.in_(ids))
                )
            ).scalars()
        }
        for aid in ids:
            acc = accs.get(aid)
            if acc is None:
                raise GLValidationError(f"Account {aid} not found")
            if not acc.is_postable or not acc.active:
                raise GLValidationError(f"Account {acc.code} is not postable")

    async def create_entry(
        self,
        *,
        entry_date: date,
        lines: list[LineInput],
        currency: str | None = None,
        fx_rate: Decimal | None = None,
        memo: str = "",
        source_type: str | None = None,
        source_id: str | None = None,
        created_by: str | None = None,
        post: bool = False,
    ) -> GLJournalEntry:
        base = base_currency()
        currency = (currency or base).upper()
        rate = Decimal(1) if currency == base else Decimal(str(fx_rate or 0))
        if rate <= 0:
            raise GLValidationError(f"fx_rate is required for {currency} (base {base})")
        await self._check_accounts(lines)
        period = await self.period_for(entry_date)
        if period.status == PERIOD_CLOSED:
            raise GLConflictError(f"Period {period.name} is closed")
        entry = GLJournalEntry(
            tenant_id=self.tenant_id,
            entry_date=entry_date,
            period_id=period.id,
            fiscal_year_id=period.fiscal_year_id,
            currency=currency,
            base_currency=base,
            fx_rate=rate,
            status=ENTRY_DRAFT,
            memo=memo or "",
            source_type=source_type,
            source_id=source_id,
            created_by=created_by,
        )
        entry.lines = build_lines(lines, rate, self.tenant_id)
        self.session.add(entry)
        await self.session.flush()
        if post:
            await self.post_entry(entry.id)
        return entry

    async def update_draft(self, entry_id: uuid.UUID, **data: Any) -> GLJournalEntry:
        entry = await self.get_entry(entry_id)
        if entry.status != ENTRY_DRAFT:
            raise GLConflictError("Posted entries are immutable; reverse instead")
        lines: list[LineInput] | None = data.pop("lines", None)
        if "entry_date" in data and data["entry_date"] is not None:
            period = await self.period_for(data["entry_date"])
            if period.status == PERIOD_CLOSED:
                raise GLConflictError(f"Period {period.name} is closed")
            entry.period_id, entry.fiscal_year_id = period.id, period.fiscal_year_id
        if "fx_rate" in data and data["fx_rate"] is not None and entry.currency != entry.base_currency:
            entry.fx_rate = Decimal(str(data["fx_rate"]))
        for k in ("entry_date", "memo", "source_type", "source_id"):
            if k in data and data[k] is not None:
                setattr(entry, k, data[k])
        if lines is not None:
            await self._check_accounts(lines)
            entry.lines.clear()
            await self.session.flush()
            entry.lines.extend(build_lines(lines, Decimal(entry.fx_rate), self.tenant_id))
        elif "fx_rate" in data:
            for ln in entry.lines:
                ln.base_debit = money(ln.debit * entry.fx_rate)
                ln.base_credit = money(ln.credit * entry.fx_rate)
        await self.session.flush()
        return entry

    async def delete_draft(self, entry_id: uuid.UUID) -> None:
        entry = await self.get_entry(entry_id)
        if entry.status != ENTRY_DRAFT:
            raise GLConflictError("Posted entries are immutable; reverse instead")
        await self.session.delete(entry)
        await self.session.flush()

    async def _next_number(self, fiscal_year_id: uuid.UUID) -> tuple[int, str]:
        fy = await self.session.scalar(
            select(GLFiscalYear)
            .where(GLFiscalYear.id == fiscal_year_id, GLFiscalYear.tenant_id == self.tenant_id)
            .with_for_update()
        )
        if fy is None:
            raise GLNotFoundError("Fiscal year not found")
        fy.last_number += 1
        return fy.last_number, f"{fy.name}-{fy.last_number:06d}"

    async def post_entry(self, entry_id: uuid.UUID) -> GLJournalEntry:
        entry = await self.get_entry(entry_id)
        if entry.status != ENTRY_DRAFT:
            raise GLConflictError(f"Entry is already {entry.status}")
        period = await self._own(GLPeriod, entry.period_id)
        if period is None or period.status == PERIOD_CLOSED:
            raise GLConflictError("Cannot post into a closed period")
        await self._check_accounts([LineInput(account_id=ln.account_id) for ln in entry.lines])
        check_balanced(entry.lines)
        entry.seq, entry.number = await self._next_number(entry.fiscal_year_id)
        entry.status = ENTRY_POSTED
        await self.session.flush()
        return entry

    async def reverse_entry(
        self, entry_id: uuid.UUID, *, on: date | None = None, memo: str | None = None, created_by: str | None = None
    ) -> GLJournalEntry:
        orig = await self.get_entry(entry_id)
        if orig.status != ENTRY_POSTED:
            raise GLConflictError(f"Only posted entries can be reversed (status: {orig.status})")
        on = on or orig.entry_date
        period = await self.period_for(on)
        if period.status == PERIOD_CLOSED:
            raise GLConflictError(f"Period {period.name} is closed")
        rev = GLJournalEntry(
            tenant_id=self.tenant_id,
            entry_date=on,
            period_id=period.id,
            fiscal_year_id=period.fiscal_year_id,
            currency=orig.currency,
            base_currency=orig.base_currency,
            fx_rate=orig.fx_rate,
            status=ENTRY_DRAFT,
            memo=memo or f"Reversal of {orig.number}",
            source_type=orig.source_type,
            source_id=orig.source_id,
            reversal_of_id=orig.id,
            created_by=created_by,
        )
        rev.lines = [
            GLJournalLine(
                tenant_id=self.tenant_id,
                line_no=ln.line_no,
                account_id=ln.account_id,
                description=ln.description,
                debit=ln.credit,
                credit=ln.debit,
                base_debit=ln.base_credit,
                base_credit=ln.base_debit,
                tax_code=ln.tax_code,
                cost_center=ln.cost_center,
                project_id=ln.project_id,
            )
            for ln in orig.lines
        ]
        self.session.add(rev)
        await self.session.flush()
        check_balanced(rev.lines)
        rev.seq, rev.number = await self._next_number(rev.fiscal_year_id)
        rev.status = ENTRY_POSTED
        orig.status = ENTRY_REVERSED
        orig.reversed_by_id = rev.id
        await self.session.flush()
        return rev

    # ── Reports ───────────────────────────────────────────────────────────
    async def _sums(self, *, date_from: date | None, date_to: date | None) -> dict[uuid.UUID, tuple[Decimal, Decimal]]:
        from sqlalchemy import func

        stmt = (
            select(
                GLJournalLine.account_id,
                func.coalesce(func.sum(GLJournalLine.base_debit), 0),
                func.coalesce(func.sum(GLJournalLine.base_credit), 0),
            )
            .join(GLJournalEntry, GLJournalEntry.id == GLJournalLine.entry_id)
            .where(GLJournalEntry.tenant_id == self.tenant_id, GLJournalEntry.status.in_(LEDGER_STATUSES))
            .group_by(GLJournalLine.account_id)
        )
        if date_from:
            stmt = stmt.where(GLJournalEntry.entry_date >= date_from)
        if date_to:
            stmt = stmt.where(GLJournalEntry.entry_date <= date_to)
        return {aid: (money(dr), money(cr)) for aid, dr, cr in (await self.session.execute(stmt)).all()}

    async def trial_balance(self, date_from: date | None, date_to: date | None) -> dict[str, Any]:
        opening = await self._sums(date_from=None, date_to=date_from - timedelta(days=1)) if date_from else {}
        period = await self._sums(date_from=date_from, date_to=date_to)
        rows = []
        tot = defaultdict(lambda: ZERO)
        for acc in await self.list_accounts():
            o_dr, o_cr = opening.get(acc.id, (ZERO, ZERO))
            p_dr, p_cr = period.get(acc.id, (ZERO, ZERO))
            if not any((o_dr, o_cr, p_dr, p_cr)):
                continue
            opening_bal = o_dr - o_cr
            closing = opening_bal + p_dr - p_cr
            rows.append(
                {
                    "account_id": acc.id,
                    "code": acc.code,
                    "name": acc.name,
                    "account_type": acc.account_type,
                    "opening": opening_bal,
                    "debit": p_dr,
                    "credit": p_cr,
                    "closing": closing,
                }
            )
            tot["debit"] += p_dr
            tot["credit"] += p_cr
            tot["closing"] += closing
        return {
            "base_currency": base_currency(),
            "date_from": date_from,
            "date_to": date_to,
            "rows": rows,
            "total_debit": tot["debit"],
            "total_credit": tot["credit"],
            "balanced": tot["debit"] == tot["credit"] and tot["closing"] == ZERO,
        }

    async def account_ledger(
        self, account_id: uuid.UUID, date_from: date | None, date_to: date | None
    ) -> dict[str, Any]:
        acc = await self.get_account(account_id)
        opening = ZERO
        if date_from:
            dr, cr = (await self._sums(date_from=None, date_to=date_from - timedelta(days=1))).get(acc.id, (ZERO, ZERO))
            opening = dr - cr
        stmt = (
            select(GLJournalLine, GLJournalEntry)
            .join(GLJournalEntry, GLJournalEntry.id == GLJournalLine.entry_id)
            .where(
                GLJournalEntry.tenant_id == self.tenant_id,
                GLJournalLine.account_id == acc.id,
                GLJournalEntry.status.in_(LEDGER_STATUSES),
            )
            .order_by(GLJournalEntry.entry_date, GLJournalEntry.seq, GLJournalLine.line_no)
        )
        if date_from:
            stmt = stmt.where(GLJournalEntry.entry_date >= date_from)
        if date_to:
            stmt = stmt.where(GLJournalEntry.entry_date <= date_to)
        running, rows = opening, []
        for ln, entry in (await self.session.execute(stmt)).all():
            running += ln.base_debit - ln.base_credit
            rows.append(
                {
                    "entry_id": entry.id,
                    "number": entry.number,
                    "entry_date": entry.entry_date,
                    "memo": entry.memo,
                    "description": ln.description,
                    "debit": ln.base_debit,
                    "credit": ln.base_credit,
                    "balance": running,
                }
            )
        return {
            "account_id": acc.id,
            "code": acc.code,
            "name": acc.name,
            "base_currency": base_currency(),
            "opening": opening,
            "closing": running,
            "rows": rows,
        }

    async def _by_type(self, date_from: date | None, date_to: date | None, types: tuple[str, ...]) -> dict:
        sums = await self._sums(date_from=date_from, date_to=date_to)
        sections: dict[str, dict[str, Any]] = {t: {"accounts": [], "total": ZERO} for t in types}
        for acc in await self.list_accounts():
            if acc.account_type not in types or acc.id not in sums:
                continue
            dr, cr = sums[acc.id]
            bal = natural_balance(acc.account_type, dr, cr)
            if bal == ZERO:
                continue
            sec = sections[acc.account_type]
            sec["accounts"].append({"account_id": acc.id, "code": acc.code, "name": acc.name, "balance": bal})
            sec["total"] += bal
        return sections

    async def profit_and_loss(self, date_from: date | None, date_to: date | None) -> dict[str, Any]:
        s = await self._by_type(date_from, date_to, ("income", "expense"))
        return {
            "base_currency": base_currency(),
            "date_from": date_from,
            "date_to": date_to,
            "income": s["income"],
            "expense": s["expense"],
            "net_income": s["income"]["total"] - s["expense"]["total"],
        }

    async def balance_sheet(self, as_of: date) -> dict[str, Any]:
        s = await self._by_type(None, as_of, ("asset", "liability", "equity", "income", "expense"))
        earnings = s["income"]["total"] - s["expense"]["total"]
        assets = s["asset"]["total"]
        liab_eq = s["liability"]["total"] + s["equity"]["total"] + earnings
        return {
            "base_currency": base_currency(),
            "as_of": as_of,
            "asset": s["asset"],
            "liability": s["liability"],
            "equity": s["equity"],
            "unclosed_earnings": earnings,
            "total_assets": assets,
            "total_liabilities_equity": liab_eq,
            "balanced": assets == liab_eq,
        }

    async def _codes_sum(self, codes: list[str], date_from: date | None, date_to: date | None) -> list[dict]:
        sums = await self._sums(date_from=date_from, date_to=date_to)
        out = []
        for acc in await self.list_accounts():
            if acc.code in codes:
                dr, cr = sums.get(acc.id, (ZERO, ZERO))
                out.append({"account_id": acc.id, "code": acc.code, "name": acc.name, "debit": dr, "credit": cr})
        return out

    async def vat_report(
        self, date_from: date | None, date_to: date | None, output_codes: list[str], input_codes: list[str]
    ) -> dict[str, Any]:
        """Output VAT (net credit) minus input VAT (net debit) for the period; positive = payable."""
        out_rows = await self._codes_sum(output_codes, date_from, date_to)
        in_rows = await self._codes_sum(input_codes, date_from, date_to)
        output = sum((r["credit"] - r["debit"] for r in out_rows), ZERO)
        input_ = sum((r["debit"] - r["credit"] for r in in_rows), ZERO)
        return {
            "base_currency": base_currency(),
            "date_from": date_from,
            "date_to": date_to,
            "output_accounts": out_rows,
            "input_accounts": in_rows,
            "output_vat": output,
            "input_vat": input_,
            "net_payable": output - input_,
        }

    async def kpis(self, as_of: date) -> dict[str, Any]:
        year_start = date(as_of.year, 1, 1)
        month_start = as_of.replace(day=1)
        pl_ytd = await self.profit_and_loss(year_start, as_of)
        pl_mtd = await self.profit_and_loss(month_start, as_of)
        bs = await self.balance_sheet(as_of)
        drafts = len(await self.list_entries(status="draft", limit=10000))
        return {
            "base_currency": base_currency(),
            "as_of": as_of,
            "revenue_ytd": pl_ytd["income"]["total"],
            "net_income_ytd": pl_ytd["net_income"],
            "net_income_mtd": pl_mtd["net_income"],
            "total_assets": bs["total_assets"],
            "balanced": bs["balanced"],
            "draft_entries": drafts,
        }

    # ── Attachments ───────────────────────────────────────────────────────
    MAX_ATTACHMENT = 10 * 1024 * 1024

    async def add_attachment(
        self, entry_id: uuid.UUID, filename: str, content_type: str | None, data: bytes, by: str | None = None
    ) -> Any:
        from app.modules.gl.models import GLAttachment

        await self.get_entry(entry_id)
        if not data:
            raise GLValidationError("File is empty")
        if len(data) > self.MAX_ATTACHMENT:
            raise GLValidationError("File is larger than 10 MB")
        att = GLAttachment(
            tenant_id=self.tenant_id,
            entry_id=entry_id,
            filename=(filename or "file")[:255],
            content_type=content_type or "application/octet-stream",
            size=len(data),
            data=data,
            uploaded_by=by,
        )
        self.session.add(att)
        await self.session.flush()
        return att

    async def list_attachments(self, entry_id: uuid.UUID) -> list[Any]:
        from app.modules.gl.models import GLAttachment

        await self.get_entry(entry_id)
        stmt = select(GLAttachment).where(GLAttachment.tenant_id == self.tenant_id, GLAttachment.entry_id == entry_id)
        return list((await self.session.execute(stmt.order_by(GLAttachment.created_at))).scalars())

    async def get_attachment(self, attachment_id: uuid.UUID) -> Any:
        from app.modules.gl.models import GLAttachment

        att = await self._own(GLAttachment, attachment_id)
        if att is None:
            raise GLNotFoundError("Attachment not found")
        return att

    async def delete_attachment(self, attachment_id: uuid.UUID) -> None:
        await self.session.delete(await self.get_attachment(attachment_id))
        await self.session.flush()
