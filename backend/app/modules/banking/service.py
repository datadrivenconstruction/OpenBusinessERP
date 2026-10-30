"""Banking service: accounts, statement import with dedupe, match suggestions, confirmation posting.

Customer receipts post through ``SalesService.record_payment`` against the bank
account's own GL account; supplier payments post through
``PurchasingService.record_payment`` (its ``bank`` role) followed by a reclass
entry when the bank account uses a different GL account.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date
from decimal import Decimal
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.banking.matching import BankLine, OpenItem, Suggestion, _norm, suggest
from app.modules.banking.models import (
    BankAccount,
    BankMatch,
    BankPartnerIban,
    BankSettings,
    BankStatement,
    BankTransaction,
)
from app.modules.banking.parsers import StatementParseError, detect_format, parse_opening_balance, parse_statement
from app.modules.gl.models import DEFAULT_TENANT, ENTRY_POSTED, GLAccount, GLJournalEntry
from app.modules.gl.service import GLError, GLService, LineInput, money
from app.modules.sales.models import SalesDocument, SalesPayment
from app.modules.sales.service import SalesError, SalesService

ZERO = Decimal(0)
SOURCE_BANK = "bank_transaction"
# Chart fallbacks for the write-off account: SKR03 "Sonstige betriebliche Aufwendungen", IFRS "Other operating expenses".
DEFAULT_WRITEOFF_CODES = ("4900", "5500")


class BankingError(Exception):
    pass


class BankingNotFoundError(BankingError):
    pass


class BankingValidationError(BankingError):
    pass


class BankingConflictError(BankingError):
    pass


@dataclass
class AllocationIn:
    target_type: str  # sales_invoice | purchase_bill
    target_id: uuid.UUID
    amount: Decimal


class PaymentProvider:
    """Interface for live bank feeds (PSD2/EBICS).

    Not implemented: a live connection needs a licensed account-information
    provider and its contract. Statement files (camt/MT940/CSV) are the
    supported path; an adapter would implement :meth:`fetch` returning the same
    ``ParsedTxn`` objects the parsers produce.
    """

    name = "none"

    async def fetch(self, account: BankAccount, since: date) -> list[Any]:  # pragma: no cover
        raise NotImplementedError("No licensed bank-feed provider is configured")


def partner_key(partner_id: uuid.UUID | None, name: str) -> str:
    return str(partner_id) if partner_id else f"name:{_norm(name)}"


def _purchasing():
    """Purchasing is optional; return (service class, bill model) or (None, None)."""
    try:
        from app.modules.purchasing.models import PurchasingBill
        from app.modules.purchasing.service import PurchasingService
    except ImportError:  # pragma: no cover
        return None, None
    return PurchasingService, PurchasingBill


class BankingService:
    def __init__(self, session: AsyncSession, tenant_id: str = DEFAULT_TENANT) -> None:
        self.session = session
        self.tenant_id = tenant_id
        self.gl = GLService(session, tenant_id)

    # ── Settings ──────────────────────────────────────────────────────────
    async def settings(self) -> BankSettings:
        row = await self.session.scalar(select(BankSettings).where(BankSettings.tenant_id == self.tenant_id))
        if row is None:
            row = BankSettings(
                tenant_id=self.tenant_id, amount_tolerance=Decimal("0.05"), date_window_days=30,
                writeoff_account_code="", writeoff_max=Decimal("5.00"),
            )
            self.session.add(row)
            await self.session.flush()
        return row

    async def update_settings(self, **data: Any) -> BankSettings:
        row = await self.settings()
        for k in ("amount_tolerance", "date_window_days", "writeoff_account_code", "writeoff_max"):
            if data.get(k) is not None:
                setattr(row, k, data[k])
        if row.writeoff_account_code:
            await self._account_id(row.writeoff_account_code, "write-off")
        await self.session.flush()
        return row

    # ── Accounts ──────────────────────────────────────────────────────────
    async def list_accounts(self) -> list[BankAccount]:
        q = select(BankAccount).where(BankAccount.tenant_id == self.tenant_id).order_by(BankAccount.name)
        return list((await self.session.execute(q)).scalars())

    async def get_account(self, account_id: uuid.UUID) -> BankAccount:
        acc = await self.session.get(BankAccount, account_id)
        if acc is None or acc.tenant_id != self.tenant_id:
            raise BankingNotFoundError("Bank account not found")
        return acc

    async def create_account(self, **data: Any) -> BankAccount:
        code = data.get("gl_account_code") or (await SalesService(self.session, self.tenant_id).account_mapping()).get("bank") or ""
        iban = (data.get("iban") or "").replace(" ", "").upper()
        if iban and await self.session.scalar(
            select(BankAccount.id).where(BankAccount.tenant_id == self.tenant_id, BankAccount.iban == iban)
        ):
            raise BankingConflictError("A bank account with this IBAN already exists")
        acc = BankAccount(
            tenant_id=self.tenant_id, name=data["name"], iban=iban, bic=(data.get("bic") or "").upper(),
            currency=(data.get("currency") or "EUR").upper(), gl_account_code=code, active=True,
            opening_balance=money(Decimal(str(data.get("opening_balance") or 0))),
            opening_balance_date=data.get("opening_balance_date"),
        )
        self.session.add(acc)
        await self.session.flush()
        return acc

    async def update_account(self, account_id: uuid.UUID, **data: Any) -> BankAccount:
        acc = await self.get_account(account_id)
        for k in ("name", "bic", "currency", "gl_account_code", "active"):
            if data.get(k) is not None:
                setattr(acc, k, data[k])
        if data.get("opening_balance") is not None:
            acc.opening_balance = money(Decimal(str(data["opening_balance"])))
        if data.get("opening_balance") is not None or data.get("opening_balance_date") is not None:
            acc.opening_balance_date = data.get("opening_balance_date")
        await self.session.flush()
        return acc

    async def _account_id(self, code: str, what: str) -> uuid.UUID:
        acc = await self.session.scalar(
            select(GLAccount).where(GLAccount.tenant_id == self.tenant_id, GLAccount.code == code)
        ) if code else None
        if acc is None:
            raise BankingConflictError(f"GL account for {what} is missing (code {code or 'unset'})")
        return acc.id

    # ── Import ────────────────────────────────────────────────────────────
    async def import_statement(
        self,
        account_id: uuid.UUID,
        content: bytes | str,
        *,
        fmt: str | None = None,
        mapping: dict[str, Any] | None = None,
        filename: str = "",
        created_by: str | None = None,
    ) -> BankStatement:
        acc = await self.get_account(account_id)
        try:
            parsed = parse_statement(content, fmt, mapping)
        except StatementParseError as exc:
            raise BankingValidationError(str(exc)) from exc
        existing = set(
            (await self.session.execute(
                select(BankTransaction.dedupe_key).where(
                    BankTransaction.tenant_id == self.tenant_id, BankTransaction.account_id == acc.id
                )
            )).scalars()
        )
        stmt = BankStatement(
            tenant_id=self.tenant_id, account_id=acc.id, filename=filename[:255],
            format=fmt or "auto", created_by=created_by, imported_count=0, duplicate_count=0,
        )
        self.session.add(stmt)
        if not existing:
            opening = parse_opening_balance(content, fmt or detect_format(content))
            if opening is not None:
                acc.opening_balance, acc.opening_balance_date = money(opening[0]), opening[1]
        await self.session.flush()
        for p in parsed:
            key = p.dedupe_key
            if key in existing:
                stmt.duplicate_count += 1
                continue
            existing.add(key)
            self.session.add(BankTransaction(
                tenant_id=self.tenant_id, account_id=acc.id, statement_id=stmt.id,
                booking_date=p.booking_date, value_date=p.value_date, amount=money(p.amount),
                currency=p.currency.upper(), counterparty_name=p.counterparty_name[:255],
                counterparty_iban=p.counterparty_iban[:34], remittance=p.remittance,
                reference=p.reference[:140], dedupe_key=key, status="unmatched", matched_amount=ZERO,
            ))
            stmt.imported_count += 1
        await self.session.flush()
        return stmt

    # ── Transactions ──────────────────────────────────────────────────────
    async def list_transactions(
        self, account_id: uuid.UUID | None = None, status: str | None = None, limit: int = 500
    ) -> list[BankTransaction]:
        q = select(BankTransaction).where(BankTransaction.tenant_id == self.tenant_id)
        if account_id:
            q = q.where(BankTransaction.account_id == account_id)
        if status:
            q = q.where(BankTransaction.status.in_(status.split(",")))
        q = q.order_by(BankTransaction.booking_date.desc(), BankTransaction.created_at.desc()).limit(limit)
        return list((await self.session.execute(q)).scalars())

    async def get_transaction(self, txn_id: uuid.UUID) -> BankTransaction:
        txn = await self.session.get(BankTransaction, txn_id)
        if txn is None or txn.tenant_id != self.tenant_id:
            raise BankingNotFoundError("Bank transaction not found")
        return txn

    async def set_ignored(self, txn_id: uuid.UUID, ignored: bool) -> BankTransaction:
        txn = await self.get_transaction(txn_id)
        if txn.matched_amount:
            raise BankingConflictError("Line already has confirmed matches")
        txn.status = "ignored" if ignored else "unmatched"
        await self.session.flush()
        return txn

    # ── Suggestions ───────────────────────────────────────────────────────
    async def open_items(self) -> list[OpenItem]:
        ibans: dict[str, list[str]] = {}
        for row in (await self.session.execute(
            select(BankPartnerIban).where(BankPartnerIban.tenant_id == self.tenant_id)
        )).scalars():
            ibans.setdefault(row.partner_key, []).append(row.iban)
        items: list[OpenItem] = []
        D = SalesDocument
        for inv in (await self.session.execute(select(D).where(
            D.tenant_id == self.tenant_id, D.kind == "invoice", D.status.in_(("issued", "partially_paid"))
        ))).scalars():
            key = partner_key(inv.customer_id, inv.customer_name)
            items.append(OpenItem(
                "sales_invoice", inv.id, inv.number, inv.customer_name, inv.gross_total - inv.amount_paid,
                inv.currency, inv.due_date, inv.doc_date, key, tuple(ibans.get(key, ())),
            ))
        _, Bill = _purchasing()
        if Bill is not None:
            for bill in (await self.session.execute(select(Bill).where(
                Bill.tenant_id == self.tenant_id, Bill.kind == "bill", Bill.status.in_(("posted", "partially_paid"))
            ))).scalars():
                key = partner_key(bill.supplier_id, bill.supplier_name)
                items.append(OpenItem(
                    "purchase_bill", bill.id, bill.number, bill.supplier_name, bill.gross_total - bill.amount_paid,
                    bill.currency, bill.due_date, bill.doc_date, key, tuple(ibans.get(key, ())),
                    partner_ref=bill.supplier_ref or "",
                ))
        return items

    async def suggestions(self, txn_id: uuid.UUID, limit: int = 5) -> list[Suggestion]:
        txn = await self.get_transaction(txn_id)
        if txn.status in ("matched", "ignored"):
            return []
        cfg = await self.settings()
        remaining = abs(txn.amount) - txn.matched_amount
        line = BankLine(
            amount=remaining if txn.amount > 0 else -remaining, booking_date=txn.booking_date, currency=txn.currency,
            counterparty_name=txn.counterparty_name, counterparty_iban=txn.counterparty_iban, remittance=txn.remittance,
        )
        return suggest(line, await self.open_items(), tolerance=cfg.amount_tolerance,
                       window_days=cfg.date_window_days, limit=limit)

    # ── Confirmation ──────────────────────────────────────────────────────
    async def _learn_iban(self, txn: BankTransaction, key: str, name: str) -> None:
        if not txn.counterparty_iban:
            return
        exists = await self.session.scalar(select(BankPartnerIban.id).where(
            BankPartnerIban.tenant_id == self.tenant_id, BankPartnerIban.iban == txn.counterparty_iban,
            BankPartnerIban.partner_key == key,
        ))
        if not exists:
            self.session.add(BankPartnerIban(
                tenant_id=self.tenant_id, iban=txn.counterparty_iban, partner_key=key, partner_name=name[:255]
            ))

    def _apply(self, txn: BankTransaction, amount: Decimal) -> None:
        txn.matched_amount = txn.matched_amount + amount
        txn.status = "matched" if txn.matched_amount >= abs(txn.amount) else "partially_matched"

    def _add_match(self, txn: BankTransaction, kind: str, target_id: uuid.UUID | None, number: str,
                   amount: Decimal, gl_entry_id: uuid.UUID | None, by: str | None, conf: Any = None) -> BankMatch:
        m = BankMatch(
            tenant_id=self.tenant_id, target_type=kind, target_id=target_id, target_number=number[:64],
            amount=amount, gl_entry_id=gl_entry_id, created_by=by,
            confidence=Decimal(str(conf)) if conf is not None else None,
        )
        txn.matches.append(m)
        return m

    async def confirm(
        self,
        txn_id: uuid.UUID,
        allocations: list[AllocationIn],
        *,
        write_off_difference: bool = False,
        confidence: float | None = None,
        created_by: str | None = None,
    ) -> BankTransaction:
        txn = await self.get_transaction(txn_id)
        if txn.status in ("matched", "ignored"):
            raise BankingConflictError(f"Line is {txn.status}")
        if not allocations:
            raise BankingValidationError("Choose at least one invoice or bill")
        acc = await self.get_account(txn.account_id)
        bank_gl = await self._account_id(acc.gl_account_code, f"bank account {acc.name}")
        cfg = await self.settings()
        remaining = abs(txn.amount) - txn.matched_amount
        total = sum((money(a.amount) for a in allocations), ZERO)
        if any(money(a.amount) <= 0 for a in allocations):
            raise BankingValidationError("Allocation amounts must be positive")
        if total > remaining:
            raise BankingValidationError(f"Allocations {total} exceed the open bank amount {remaining}")
        wo_id = await self._writeoff_account(cfg) if write_off_difference else None
        wo_budget = cfg.writeoff_max
        sales = SalesService(self.session, self.tenant_id)
        ref = (txn.reference or txn.remittance or "")[:128]
        try:
            for a in allocations:
                amt = money(a.amount)
                if a.target_type == "sales_invoice":
                    if txn.amount <= 0:
                        raise BankingValidationError("Outgoing payments cannot settle customer invoices")
                    inv = await sales.record_payment(
                        a.target_id, amount=amt, pay_date=txn.booking_date, reference=ref,
                        created_by=created_by, debit_account_id=bank_gl,
                    )
                    self._add_match(txn, "sales_invoice", inv.id, inv.number, amt,
                                    inv.payments[-1].gl_entry_id, created_by, confidence)
                    await self._learn_iban(txn, partner_key(inv.customer_id, inv.customer_name), inv.customer_name)
                    rest = inv.gross_total - inv.amount_paid
                    if wo_id and ZERO < rest <= wo_budget:
                        inv = await sales.record_payment(
                            inv.id, amount=rest, pay_date=txn.booking_date, method="write_off",
                            reference=f"Write-off {ref}"[:128], created_by=created_by, debit_account_id=wo_id,
                        )
                        wo_budget -= rest
                        self._add_match(txn, "write_off", inv.id, inv.number, rest,
                                        inv.payments[-1].gl_entry_id, created_by)
                elif a.target_type == "purchase_bill":
                    if txn.amount >= 0:
                        raise BankingValidationError("Incoming payments cannot settle supplier bills")
                    entry_id, number, rest = await self._pay_bill(a.target_id, amt, txn, ref, bank_gl, created_by)
                    self._add_match(txn, "purchase_bill", a.target_id, number, amt, entry_id, created_by, confidence)
                    if wo_id and ZERO < rest <= wo_budget:
                        # Supplier accepted less than billed: clear payables against the write-off account.
                        entry_id, number, _ = await self._pay_bill(
                            a.target_id, rest, txn, f"Write-off {ref}"[:128], wo_id, created_by, method="write_off")
                        wo_budget -= rest
                        self._add_match(txn, "bill_write_off", a.target_id, number, rest, entry_id, created_by)
                else:
                    raise BankingValidationError(f"Unknown target type {a.target_type}")
                self._apply(txn, amt)
            leftover = abs(txn.amount) - txn.matched_amount
            if wo_id and ZERO < leftover <= wo_budget:
                # Bank amount exceeds what was allocated: book the small excess to the write-off account.
                incoming = txn.amount > 0
                entry = await self.gl.create_entry(
                    entry_date=txn.booking_date,
                    lines=[
                        LineInput(bank_gl if incoming else wo_id, debit=leftover, description="Bank difference"),
                        LineInput(wo_id if incoming else bank_gl, credit=leftover, description="Bank difference"),
                    ],
                    currency=txn.currency, memo=f"Bank difference {ref}".strip(), source_type=SOURCE_BANK,
                    source_id=str(txn.id), created_by=created_by, post=True,
                )
                self._add_match(txn, "write_off", None, "", leftover, entry.id, created_by)
                self._apply(txn, leftover)
        except SalesError as exc:
            raise BankingConflictError(str(exc)) from exc
        except GLError as exc:
            raise BankingConflictError(f"GL: {exc}") from exc
        await self.session.flush()
        return txn

    async def _pay_bill(
        self, bill_id: uuid.UUID, amount: Decimal, txn: BankTransaction, ref: str, bank_gl: uuid.UUID, by: str | None,
        method: str = "bank_transfer",
    ) -> tuple[uuid.UUID | None, str, Decimal]:
        Purch, _ = _purchasing()
        if Purch is None:
            raise BankingConflictError("Purchasing module is not available; use a manual GL entry")
        svc = Purch(self.session, self.tenant_id)
        try:
            bill = await svc.record_payment(bill_id, amount=amount, pay_date=txn.booking_date, reference=ref,
                                          method=method, created_by=by)
        except Exception as exc:  # purchasing has its own error hierarchy
            if exc.__class__.__name__.startswith("Purchasing"):
                raise BankingConflictError(str(exc)) from exc
            raise
        role_bank = (await svc._accounts("bank"))["bank"]
        if role_bank != bank_gl:
            await self.gl.create_entry(
                entry_date=txn.booking_date,
                lines=[
                    LineInput(role_bank, debit=amount, description=f"Reclass {bill.number}"),
                    LineInput(bank_gl, credit=amount, description=f"Reclass {bill.number}"),
                ],
                currency=bill.currency, fx_rate=bill.fx_rate, memo=f"Bank account reclass {bill.number}",
                source_type=SOURCE_BANK, source_id=str(txn.id), created_by=by, post=True,
            )
        await self._learn_iban(txn, partner_key(bill.supplier_id, bill.supplier_name), bill.supplier_name)
        return bill.payments[-1].gl_entry_id, bill.number, bill.gross_total - bill.amount_paid

    async def _writeoff_account(self, cfg: BankSettings) -> uuid.UUID:
        if cfg.writeoff_account_code:
            return await self._account_id(cfg.writeoff_account_code, "write-offs")
        for code in DEFAULT_WRITEOFF_CODES:
            acc = await self.session.scalar(select(GLAccount.id).where(
                GLAccount.tenant_id == self.tenant_id, GLAccount.code == code))
            if acc:
                return acc
        raise BankingConflictError("No write-off account configured and none found in the chart")

    async def undo_match(self, txn_id: uuid.UUID, *, created_by: str | None = None) -> BankTransaction:
        """Reverse every posting of a confirmed line and set it back to unmatched."""
        txn = await self.get_transaction(txn_id)
        if not txn.matches:
            raise BankingConflictError("Line has no confirmed matches")
        _, Bill = _purchasing()
        entry_ids: set[uuid.UUID] = set()
        try:
            for m in list(txn.matches):
                if m.gl_entry_id is None:
                    continue
                entry_ids.add(m.gl_entry_id)
                pay = await self.session.scalar(select(SalesPayment).where(
                    SalesPayment.tenant_id == self.tenant_id, SalesPayment.gl_entry_id == m.gl_entry_id))
                if pay is not None:
                    doc = await self.session.get(SalesDocument, pay.invoice_id)
                    doc.amount_paid -= pay.amount
                    doc.status = "partially_paid" if doc.amount_paid > 0 else "issued"
                    doc.payments.remove(pay)
                    continue
                if Bill is not None:
                    from app.modules.purchasing.models import PurchasingPayment
                    bpay = await self.session.scalar(select(PurchasingPayment).where(
                        PurchasingPayment.tenant_id == self.tenant_id, PurchasingPayment.gl_entry_id == m.gl_entry_id))
                    if bpay is not None:
                        bill = await self.session.get(Bill, bpay.bill_id)
                        bill.amount_paid -= bpay.amount
                        bill.status = "partially_paid" if bill.amount_paid > 0 else "posted"
                        bill.payments.remove(bpay)
            # Reclass and difference entries carry the bank line as their source.
            entry_ids.update((await self.session.execute(select(GLJournalEntry.id).where(
                GLJournalEntry.tenant_id == self.tenant_id, GLJournalEntry.source_type == SOURCE_BANK,
                GLJournalEntry.source_id == str(txn.id), GLJournalEntry.status == ENTRY_POSTED,
                GLJournalEntry.reversal_of_id.is_(None),
            ))).scalars())
            for eid in entry_ids:
                await self.gl.reverse_entry(eid, memo=f"Undo bank match {txn.reference or txn.id}"[:500],
                                            created_by=created_by)
        except GLError as exc:
            raise BankingConflictError(f"GL: {exc}") from exc
        for m in list(txn.matches):
            txn.matches.remove(m)
        txn.matched_amount = ZERO
        txn.status = "unmatched"
        await self.session.flush()
        return txn

    async def manual_entry(
        self, txn_id: uuid.UUID, *, account_code: str, memo: str = "", amount: Decimal | None = None,
        created_by: str | None = None,
    ) -> BankTransaction:
        """Book an unmatched line (fees, interest, transfers) against any GL account."""
        txn = await self.get_transaction(txn_id)
        if txn.status in ("matched", "ignored"):
            raise BankingConflictError(f"Line is {txn.status}")
        acc = await self.get_account(txn.account_id)
        bank_gl = await self._account_id(acc.gl_account_code, f"bank account {acc.name}")
        contra = await self._account_id(account_code, "the contra account")
        remaining = abs(txn.amount) - txn.matched_amount
        amt = money(amount) if amount is not None else remaining
        if amt <= 0 or amt > remaining:
            raise BankingValidationError(f"Amount must be between 0.01 and {remaining}")
        incoming = txn.amount > 0
        text = memo or txn.remittance[:200] or txn.counterparty_name
        try:
            entry = await self.gl.create_entry(
                entry_date=txn.booking_date,
                lines=[
                    LineInput(bank_gl if incoming else contra, debit=amt, description=text[:200]),
                    LineInput(contra if incoming else bank_gl, credit=amt, description=text[:200]),
                ],
                currency=txn.currency, memo=f"Bank: {text}"[:500], source_type=SOURCE_BANK,
                source_id=str(txn.id), created_by=created_by, post=True,
            )
        except GLError as exc:
            raise BankingConflictError(f"GL: {exc}") from exc
        self._add_match(txn, "gl_entry", entry.id, account_code, amt, entry.id, created_by)
        self._apply(txn, amt)
        await self.session.flush()
        return txn
