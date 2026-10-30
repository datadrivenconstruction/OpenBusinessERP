"""Bank-line → open-item matching engine (pure, stdlib only).

Signals and weights (sum capped at 1.0):
    amount     exact 0.40 · within tolerance 0.30 · partial payment 0.10
    reference  document number in the remittance text 0.35 (digits-only hit 0.20)
    partner    counterparty name tokens match the customer/supplier 0.15
    iban       counterparty IBAN seen on an earlier confirmed payment 0.20
    date       booking date close to due/document date, up to 0.10
Split suggestions combine up to three open items of one partner (or every number
the remittance names) whose open amounts add up to the bank amount.
"""

from __future__ import annotations

import itertools
import re
import unicodedata
import uuid
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

ZERO = Decimal(0)
_STOP = {"gmbh", "ag", "kg", "ug", "ltd", "llc", "inc", "co", "und", "and", "the", "der", "die", "das", "mbh", "e.k."}


@dataclass
class OpenItem:
    kind: str  # 'sales_invoice' | 'purchase_bill'
    id: uuid.UUID
    number: str
    partner_name: str
    open_amount: Decimal
    currency: str = "EUR"
    due_date: date | None = None
    doc_date: date | None = None
    partner_key: str = ""
    partner_ibans: tuple[str, ...] = ()
    partner_ref: str = ""  # e.g. supplier's own invoice number


@dataclass
class BankLine:
    amount: Decimal
    booking_date: date
    currency: str = "EUR"
    counterparty_name: str = ""
    counterparty_iban: str = ""
    remittance: str = ""


@dataclass
class Allocation:
    kind: str
    id: uuid.UUID
    number: str
    amount: Decimal


@dataclass
class Suggestion:
    score: float
    allocations: list[Allocation]
    reasons: list[str] = field(default_factory=list)
    difference: Decimal = ZERO  # bank amount minus allocated (abs values)

    @property
    def is_split(self) -> bool:
        return len(self.allocations) > 1


def _norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _tokens(s: str) -> set[str]:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().lower()
    return {t for t in re.findall(r"[a-z0-9]+", s) if len(t) >= 3 and t not in _STOP}


def number_hit(number: str, remittance: str) -> float:
    """1.0 for the full number, 0.57 (≈0.20/0.35) for a digits-only token, else 0."""
    if not number:
        return 0.0
    n, r = _norm(number), _norm(remittance)
    if len(n) >= 4 and n in r:
        return 1.0
    digits = re.sub(r"\D", "", number).lstrip("0")
    if len(digits) >= 3 and re.search(rf"(?<!\d)0*{digits}(?!\d)", remittance or ""):
        return 0.57
    return 0.0


def name_hit(partner: str, line: BankLine) -> float:
    want = _tokens(partner)
    if not want:
        return 0.0
    have = _tokens(line.counterparty_name) | _tokens(line.remittance)
    return len(want & have) / len(want)


def _amount_score(bank: Decimal, open_amt: Decimal, tolerance: Decimal) -> tuple[float, str]:
    diff = abs(bank - open_amt)
    if diff == 0:
        return 0.40, "amount equal"
    if diff <= tolerance:
        return 0.30, f"amount within tolerance ({diff})"
    if bank < open_amt:
        return 0.10, "partial payment"
    return 0.0, ""


def _date_score(on: date, item: OpenItem, window_days: int) -> float:
    ref = item.due_date or item.doc_date
    if ref is None or window_days <= 0:
        return 0.0
    days = abs((on - ref).days)
    return 0.10 * max(0.0, 1 - days / window_days)


def score_item(line: BankLine, item: OpenItem, tolerance: Decimal, window_days: int = 30) -> Suggestion:
    bank = abs(line.amount)
    reasons: list[str] = []
    s, why = _amount_score(bank, item.open_amount, tolerance)
    if why:
        reasons.append(why)
    nh = max(number_hit(item.number, line.remittance), number_hit(item.partner_ref, line.remittance))
    if nh:
        s += 0.35 * nh
        reasons.append("document number in remittance" if nh == 1.0 else "number digits in remittance")
    pn = name_hit(item.partner_name, line)
    if pn:
        s += 0.15 * pn
        reasons.append("partner name")
    if line.counterparty_iban and line.counterparty_iban in item.partner_ibans:
        s += 0.20
        reasons.append("known IBAN")
    ds = _date_score(line.booking_date, item, window_days)
    if ds:
        s += ds
    if item.currency != line.currency:
        s *= 0.5
        reasons.append("currency differs")
    alloc = min(bank, item.open_amount)
    return Suggestion(
        round(min(s, 1.0), 3), [Allocation(item.kind, item.id, item.number, alloc)], reasons, bank - alloc
    )


def suggest(
    line: BankLine,
    items: list[OpenItem],
    *,
    tolerance: Decimal = Decimal("0.05"),
    window_days: int = 30,
    limit: int = 5,
    min_score: float = 0.15,
) -> list[Suggestion]:
    """Ranked single and split suggestions. Credits match sales invoices, debits supplier bills."""
    kind = "sales_invoice" if line.amount > 0 else "purchase_bill"
    pool = [i for i in items if i.kind == kind and i.open_amount > 0]
    singles = [score_item(line, i, tolerance, window_days) for i in pool]
    out = [s for s in singles if s.score >= min_score]
    out.extend(_splits(line, pool, tolerance, window_days))
    out.sort(key=lambda s: (-s.score, len(s.allocations)))
    return out[:limit]


def _splits(line: BankLine, pool: list[OpenItem], tolerance: Decimal, window_days: int) -> list[Suggestion]:
    bank = abs(line.amount)
    found: list[Suggestion] = []
    named = [i for i in pool if number_hit(i.number, line.remittance) == 1.0]
    groups: list[list[OpenItem]] = []
    if len(named) > 1:
        groups.append(named)
    by_partner: dict[str, list[OpenItem]] = {}
    for i in pool:
        by_partner.setdefault(i.partner_key or _norm(i.partner_name), []).append(i)
    for members in by_partner.values():
        if len(members) < 2 or len(members) > 12:
            continue
        for r in (2, 3):
            for combo in itertools.combinations(members, r):
                if abs(sum((c.open_amount for c in combo), ZERO) - bank) <= tolerance:
                    groups.append(list(combo))
    seen: set[frozenset] = set()
    for g in groups:
        key = frozenset(i.id for i in g)
        if key in seen:
            continue
        seen.add(key)
        total = sum((i.open_amount for i in g), ZERO)
        reasons = []
        s = 0.0
        if abs(total - bank) <= tolerance:
            s += 0.40 if total == bank else 0.30
            reasons.append(f"sum of {len(g)} open items")
        hits = sum(number_hit(i.number, line.remittance) for i in g) / len(g)
        if hits:
            s += 0.35 * hits
            reasons.append("numbers in remittance")
        pn = max(name_hit(i.partner_name, line) for i in g)
        if pn:
            s += 0.15 * pn
            reasons.append("partner name")
        if line.counterparty_iban and any(line.counterparty_iban in i.partner_ibans for i in g):
            s += 0.20
            reasons.append("known IBAN")
        # Allocate in due-date order; the last item takes what is left.
        remaining = bank
        allocs: list[Allocation] = []
        for i in sorted(g, key=lambda x: (x.due_date or x.doc_date or date.max, x.number)):
            a = min(remaining, i.open_amount)
            if a <= 0:
                break
            allocs.append(Allocation(i.kind, i.id, i.number, a))
            remaining -= a
        if s >= 0.3:
            found.append(Suggestion(round(min(s, 1.0) - 0.01, 3), allocs, reasons, remaining))
    return found
