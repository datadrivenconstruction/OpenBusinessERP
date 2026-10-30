"""Banking workspace: KPI summary, import preview, bulk accept and categorisation rules.

Built on ``BankingService`` so every query stays tenant-scoped through it.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import func, select

from app.modules.banking.models import BankMatch, BankRule, BankTransaction
from app.modules.banking.parsers import StatementParseError, detect_format, parse_statement
from app.modules.banking.rules import DIRECTIONS, FIELDS, LineText, first_match, valid_pattern
from app.modules.banking.service import (
    AllocationIn,
    BankingError,
    BankingNotFoundError,
    BankingService,
    BankingValidationError,
)
from app.modules.gl.models import ENTRY_POSTED, GLAccount, GLJournalEntry, GLJournalLine

ZERO = Decimal(0)
OPEN = ("unmatched", "partially_matched")
PREVIEW_ROWS = 200


@dataclass
class BulkResult:
    accepted: list[uuid.UUID] = field(default_factory=list)
    skipped: int = 0
    errors: list[str] = field(default_factory=list)


def _line_text(t: Any) -> LineText:
    return LineText(t.amount, t.counterparty_name, t.counterparty_iban, t.remittance, t.reference)


class BankingWorkspace(BankingService):
    # ── KPI summary ───────────────────────────────────────────────────────
    async def summary(self, today: date | None = None) -> dict[str, Any]:
        today = today or date.today()
        month_start = today.replace(day=1)
        T = BankTransaction
        per = {
            r.account_id: r
            for r in (
                await self.session.execute(
                    select(
                        T.account_id,
                        func.coalesce(func.sum(T.amount), 0).label("balance"),
                        func.count().label("lines"),
                        func.count().filter(T.status.in_(OPEN)).label("open_lines"),
                        func.max(T.booking_date).label("last_booking"),
                    )
                    .where(T.tenant_id == self.tenant_id)
                    .group_by(T.account_id)
                )
            ).all()
        }
        accs = await self.list_accounts()
        gl = await self._gl_balances({a.gl_account_code for a in accs if a.gl_account_code})
        accounts = []
        for acc in accs:
            r = per.get(acc.id)
            opening = Decimal(acc.opening_balance or 0)
            balance = opening + (Decimal(r.balance) if r else ZERO)
            gl_bal = gl.get(acc.gl_account_code) if acc.gl_account_code else None
            accounts.append(
                {
                    "account_id": acc.id,
                    "name": acc.name,
                    "iban": acc.iban,
                    "currency": acc.currency,
                    "active": acc.active,
                    "balance": balance,
                    "opening_balance": opening,
                    "opening_balance_date": acc.opening_balance_date,
                    "gl_account_code": acc.gl_account_code,
                    "gl_balance": gl_bal,
                    "gl_difference": None if gl_bal is None else balance - gl_bal,
                    "line_count": r.lines if r else 0,
                    "unmatched_count": r.open_lines if r else 0,
                    "last_booking_date": r.last_booking if r else None,
                }
            )
        open_row = (
            await self.session.execute(
                select(func.count(), func.coalesce(func.sum(func.abs(T.amount) - T.matched_amount), 0)).where(
                    T.tenant_id == self.tenant_id, T.status.in_(OPEN)
                )
            )
        ).one()
        M = BankMatch
        month_row = (
            await self.session.execute(
                select(
                    func.count(func.distinct(M.transaction_id)),
                    func.coalesce(func.sum(M.amount), 0),
                    func.count().filter(M.target_type.in_(("sales_invoice", "purchase_bill"))),
                ).where(M.tenant_id == self.tenant_id, M.created_at >= month_start)
            )
        ).one()
        rules = await self.session.scalar(
            select(func.count()).select_from(BankRule).where(BankRule.tenant_id == self.tenant_id, BankRule.active)
        )
        return {
            "accounts": accounts,
            "unmatched_count": open_row[0],
            "unmatched_amount": Decimal(open_row[1]),
            "matched_this_month": month_row[0],
            "matched_amount_this_month": Decimal(month_row[1]),
            "document_matches_this_month": month_row[2],
            "active_rules": rules or 0,
        }

    async def _gl_balances(self, codes: set[str]) -> dict[str, Decimal]:
        """Posted debit-minus-credit per GL account code (base currency)."""
        if not codes:
            return {}
        A, L, E = GLAccount, GLJournalLine, GLJournalEntry
        rows = (
            await self.session.execute(
                select(A.code, func.coalesce(func.sum(L.base_debit - L.base_credit), 0))
                .select_from(A)
                .outerjoin(L, L.account_id == A.id)
                .outerjoin(E, (E.id == L.entry_id) & (E.status == ENTRY_POSTED))
                .where(A.tenant_id == self.tenant_id, A.code.in_(codes))
                .where((L.id.is_(None)) | (E.id.is_not(None)))
                .group_by(A.code)
            )
        ).all()
        return {code: Decimal(v) for code, v in rows}

    # ── Import preview ────────────────────────────────────────────────────
    async def preview_import(
        self,
        account_id: uuid.UUID,
        content: bytes | str,
        *,
        fmt: str | None = None,
        mapping: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        acc = await self.get_account(account_id)
        detected = fmt or detect_format(content)
        try:
            parsed = parse_statement(content, detected, mapping)
        except StatementParseError as exc:
            raise BankingValidationError(str(exc)) from exc
        existing = set(
            (
                await self.session.execute(
                    select(BankTransaction.dedupe_key).where(
                        BankTransaction.tenant_id == self.tenant_id, BankTransaction.account_id == acc.id
                    )
                )
            ).scalars()
        )
        rules = await self._active_rules()
        seen: set[str] = set()
        rows: list[dict[str, Any]] = []
        dup_db = dup_file = 0
        total_in = total_out = ZERO
        for p in parsed:
            key = p.dedupe_key
            if key in existing:
                state, dup_db = "duplicate", dup_db + 1
            elif key in seen:
                state, dup_file = "duplicate_in_file", dup_file + 1
            else:
                state = "new"
                if p.amount > 0:
                    total_in += p.amount
                else:
                    total_out += p.amount
            seen.add(key)
            if len(rows) < PREVIEW_ROWS:
                hit = first_match(
                    rules, LineText(p.amount, p.counterparty_name, p.counterparty_iban, p.remittance, p.reference)
                )
                rows.append(
                    {
                        "booking_date": p.booking_date,
                        "amount": p.amount,
                        "currency": p.currency,
                        "counterparty_name": p.counterparty_name,
                        "remittance": p.remittance,
                        "reference": p.reference,
                        "state": state,
                        "rule_name": hit.name if hit else None,
                    }
                )
        dates = [p.booking_date for p in parsed]
        currencies = sorted({p.currency.upper() for p in parsed})
        return {
            "format": detected,
            "total": len(parsed),
            "new_count": len(parsed) - dup_db - dup_file,
            "duplicate_count": dup_db,
            "duplicate_in_file_count": dup_file,
            "date_from": min(dates) if dates else None,
            "date_to": max(dates) if dates else None,
            "total_in": total_in,
            "total_out": total_out,
            "currency_mismatch": any(c != acc.currency for c in currencies),
            "currencies": currencies,
            "rows": rows,
        }

    # ── Bulk accept ───────────────────────────────────────────────────────
    async def bulk_accept(
        self,
        *,
        min_score: float = 0.85,
        account_id: uuid.UUID | None = None,
        limit: int = 200,
        created_by: str | None = None,
    ) -> BulkResult:
        """Confirm the top suggestion of every open line that scores >= min_score and closes exactly."""
        out = BulkResult()
        for txn in await self.list_transactions(account_id, ",".join(OPEN), limit=limit):
            sug = await self.suggestions(txn.id, limit=2)
            top = sug[0] if sug else None
            # A runner-up within 0.05 makes the choice ambiguous: leave it for a human.
            if (
                top is None
                or top.score < min_score
                or top.difference != 0
                or (len(sug) > 1 and top.score - sug[1].score < 0.05)
            ):
                out.skipped += 1
                continue
            allocs = [AllocationIn(a.kind, a.id, a.amount) for a in top.allocations]
            try:
                async with self.session.begin_nested():
                    await self.confirm(txn.id, allocs, confidence=top.score, created_by=created_by)
                out.accepted.append(txn.id)
            except BankingError as exc:
                out.skipped += 1
                out.errors.append(f"{txn.counterparty_name or txn.id}: {exc}")
        return out

    # ── Rules ─────────────────────────────────────────────────────────────
    async def _active_rules(self) -> list[BankRule]:
        q = select(BankRule).where(BankRule.tenant_id == self.tenant_id, BankRule.active)
        return list((await self.session.execute(q.order_by(BankRule.priority, BankRule.name))).scalars())

    async def list_rules(self) -> list[BankRule]:
        q = select(BankRule).where(BankRule.tenant_id == self.tenant_id).order_by(BankRule.priority, BankRule.name)
        return list((await self.session.execute(q)).scalars())

    async def get_rule(self, rule_id: uuid.UUID) -> BankRule:
        r = await self.session.get(BankRule, rule_id)
        if r is None or r.tenant_id != self.tenant_id:
            raise BankingNotFoundError("Rule not found")
        return r

    async def _check_rule(self, r: BankRule) -> None:
        if r.match_field not in FIELDS or r.direction not in DIRECTIONS:
            raise BankingValidationError("Unknown match field or direction")
        if not valid_pattern(r.pattern):
            raise BankingValidationError("Pattern is empty or not a valid regular expression")
        if r.min_amount is not None and r.max_amount is not None and r.min_amount > r.max_amount:
            raise BankingValidationError("Minimum amount is above the maximum")
        await self._account_id(r.account_code, "the rule")

    async def create_rule(self, **data: Any) -> BankRule:
        defaults = {"match_field": "any", "direction": "any", "memo": "", "priority": 100, "active": True}
        r = BankRule(tenant_id=self.tenant_id, hit_count=0, **{**defaults, **data})
        await self._check_rule(r)
        self.session.add(r)
        await self.session.flush()
        return r

    async def update_rule(self, rule_id: uuid.UUID, **data: Any) -> BankRule:
        r = await self.get_rule(rule_id)
        for k, v in data.items():
            setattr(r, k, v)
        await self._check_rule(r)
        await self.session.flush()
        return r

    async def delete_rule(self, rule_id: uuid.UUID) -> None:
        await self.session.delete(await self.get_rule(rule_id))
        await self.session.flush()

    async def rule_for(self, txn_id: uuid.UUID) -> BankRule | None:
        txn = await self.get_transaction(txn_id)
        return first_match(await self._active_rules(), _line_text(txn))

    async def apply_rules(
        self,
        *,
        account_id: uuid.UUID | None = None,
        dry_run: bool = False,
        created_by: str | None = None,
    ) -> dict[str, Any]:
        """Book every untouched open line a rule matches to that rule's account."""
        rules = await self._active_rules()
        hits: list[dict[str, Any]] = []
        errors: list[str] = []
        if rules:
            for txn in await self.list_transactions(account_id, "unmatched"):
                rule = first_match(rules, _line_text(txn))
                if rule is None:
                    continue
                hit = {
                    "transaction_id": txn.id,
                    "rule_id": rule.id,
                    "rule_name": rule.name,
                    "account_code": rule.account_code,
                    "amount": txn.amount,
                }
                if dry_run:
                    hits.append(hit)
                    continue
                try:
                    async with self.session.begin_nested():
                        await self.manual_entry(
                            txn.id, account_code=rule.account_code, memo=rule.memo or rule.name, created_by=created_by
                        )
                    rule.hit_count += 1
                    hits.append(hit)
                except BankingError as exc:
                    errors.append(f"{rule.name}: {exc}")
            await self.session.flush()
        return {"applied": 0 if dry_run else len(hits), "hits": hits, "errors": errors}
