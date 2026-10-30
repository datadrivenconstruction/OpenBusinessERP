"""Auto-categorisation rule matching (pure, no DB).

A rule matches a bank line when its pattern occurs (case/accent-insensitive)
in the chosen field, the direction fits and the absolute amount is in range.
Patterns wrapped in slashes (``/regex/``) are treated as regular expressions.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from typing import Protocol

FIELDS = ("counterparty", "text", "iban", "any")
DIRECTIONS = ("in", "out", "any")


class RuleLike(Protocol):
    match_field: str
    pattern: str
    direction: str
    min_amount: Decimal | None
    max_amount: Decimal | None
    priority: int
    active: bool


@dataclass
class LineText:
    amount: Decimal
    counterparty_name: str = ""
    counterparty_iban: str = ""
    remittance: str = ""
    reference: str = ""


def _fold(s: str) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return " ".join(s.lower().split())


def _haystack(field: str, line: LineText) -> str:
    if field == "counterparty":
        return _fold(line.counterparty_name)
    if field == "iban":
        return (line.counterparty_iban or "").replace(" ", "").lower()
    if field == "text":
        return _fold(f"{line.remittance} {line.reference}")
    return _fold(f"{line.counterparty_name} {line.counterparty_iban} {line.remittance} {line.reference}")


def valid_pattern(pattern: str) -> bool:
    p = pattern.strip()
    if len(p) > 2 and p.startswith("/") and p.endswith("/"):
        try:
            re.compile(p[1:-1])
        except re.error:
            return False
    return bool(p)


def rule_matches(rule: RuleLike, line: LineText) -> bool:
    if not rule.active:
        return False
    amt = line.amount
    if rule.direction == "in" and amt <= 0 or rule.direction == "out" and amt >= 0:
        return False
    if rule.min_amount is not None and abs(amt) < rule.min_amount:
        return False
    if rule.max_amount is not None and abs(amt) > rule.max_amount:
        return False
    hay = _haystack(rule.match_field, line)
    p = rule.pattern.strip()
    if len(p) > 2 and p.startswith("/") and p.endswith("/"):
        try:
            return re.search(p[1:-1], hay, re.IGNORECASE) is not None
        except re.error:
            return False
    needle = p.replace(" ", "").lower() if rule.match_field == "iban" else _fold(p)
    return bool(needle) and needle in hay


def first_match(rules: list[RuleLike], line: LineText) -> RuleLike | None:
    """Lowest priority number wins; ties keep the given order."""
    for r in sorted(rules, key=lambda r: r.priority):
        if rule_matches(r, line):
            return r
    return None
