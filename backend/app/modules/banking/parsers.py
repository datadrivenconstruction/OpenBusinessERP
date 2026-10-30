"""Bank statement parsers: ISO 20022 camt.053 / camt.054, SWIFT MT940, generic CSV.

Stdlib-only, written from the public format descriptions. Every parser returns a
list of :class:`ParsedTxn`; amounts are signed (credit > 0, debit < 0).
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from typing import Any

from defusedxml import ElementTree as SafeET

FORMATS = ("camt053", "camt054", "mt940", "csv")


class StatementParseError(ValueError):
    pass


@dataclass
class ParsedTxn:
    booking_date: date
    amount: Decimal
    currency: str = "EUR"
    value_date: date | None = None
    counterparty_name: str = ""
    counterparty_iban: str = ""
    remittance: str = ""
    reference: str = ""
    raw: dict[str, Any] = field(default_factory=dict)

    @property
    def dedupe_key(self) -> str:
        """Bank reference when the file has one, else a content hash."""
        if self.reference:
            return f"ref:{self.reference}"[:128]
        basis = "|".join(
            (self.booking_date.isoformat(), str(self.amount), self.currency, self.counterparty_iban,
             self.counterparty_name, self.remittance)
        )
        return "h:" + hashlib.sha256(basis.encode()).hexdigest()[:40]


def _text(data: bytes | str) -> str:
    if isinstance(data, str):
        return data
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    raise StatementParseError("Unreadable file encoding")


def parse_amount(value: str, decimal_sep: str | None = None) -> Decimal:
    """Parse '1.234,56', '1,234.56', '-12,5', '12.50-' into a Decimal."""
    s = (value or "").strip().replace(" ", "").replace(" ", "").replace("'", "")
    neg = s.startswith("-") or s.endswith("-") or (s.startswith("(") and s.endswith(")"))
    s = s.strip("-+()")
    s = re.sub(r"[^\d,.]", "", s)
    if not s:
        raise StatementParseError(f"Empty amount {value!r}")
    if decimal_sep is None:
        last_c, last_d = s.rfind(","), s.rfind(".")
        decimal_sep = "," if last_c > last_d else "."
        # '1.234' with a dot as thousands separator only: three digits after a single dot.
        if last_c == -1 and s.count(".") > 1:
            decimal_sep = ","
    thousands = "." if decimal_sep == "," else ","
    s = s.replace(thousands, "").replace(decimal_sep, ".")
    try:
        amount = Decimal(s)
    except InvalidOperation as exc:
        raise StatementParseError(f"Bad amount {value!r}") from exc
    return -amount if neg else amount


DATE_FORMATS = ("%Y-%m-%d", "%d.%m.%Y", "%d.%m.%y", "%d/%m/%Y", "%Y%m%d", "%m/%d/%Y")


def parse_date(value: str, fmt: str | None = None) -> date:
    value = (value or "").strip()
    for f in (fmt,) if fmt else DATE_FORMATS:
        for v in (value, value[:10]):
            try:
                return datetime.strptime(v, f).date()
            except ValueError:
                continue
    try:
        return datetime.fromisoformat(value).date()
    except ValueError as exc:
        raise StatementParseError(f"Unrecognised date {value!r}") from exc


# ── ISO 20022 camt.053 / camt.054 ─────────────────────────────────────────
def _strip_ns(root: Any) -> None:
    for el in root.iter():
        if isinstance(el.tag, str) and "}" in el.tag:
            el.tag = el.tag.split("}", 1)[1]


def _t(el: Any, path: str) -> str:
    if el is None:
        return ""
    found = el.find(path)
    return (found.text or "").strip() if found is not None and found.text else ""


def _date_of(el: Any, path: str) -> date | None:
    v = _t(el, f"{path}/Dt") or _t(el, f"{path}/DtTm")
    return parse_date(v[:10], "%Y-%m-%d") if v else None


def _party_name(parties: Any, role: str) -> str:
    # Version 02 nests the name directly; version 08+ wraps it in Pty.
    return _t(parties, f"{role}/Nm") or _t(parties, f"{role}/Pty/Nm")


def parse_camt(data: bytes | str) -> list[ParsedTxn]:
    raw = data.encode() if isinstance(data, str) else data
    try:
        root = SafeET.fromstring(raw)
    except Exception as exc:  # defusedxml raises several exception types
        raise StatementParseError(f"Not a valid camt XML file: {exc}") from exc
    _strip_ns(root)
    containers = root.findall(".//Stmt") + root.findall(".//Ntfctn") + root.findall(".//Rpt")
    if not containers:
        raise StatementParseError("No statement (Stmt/Ntfctn/Rpt) found in camt file")
    out: list[ParsedTxn] = []
    for stmt in containers:
        for ntry in stmt.findall("Ntry"):
            amt_el = ntry.find("Amt")
            if amt_el is None:
                continue
            sign = -1 if _t(ntry, "CdtDbtInd") == "DBIT" else 1
            if _t(ntry, "RvslInd").lower() == "true":
                sign = -sign
            ccy = amt_el.get("Ccy", "EUR")
            booking = _date_of(ntry, "BookgDt") or _date_of(ntry, "ValDt")
            if booking is None:
                raise StatementParseError("Entry without booking date")
            value = _date_of(ntry, "ValDt")
            ntry_ref = _t(ntry, "AcctSvcrRef") or _t(ntry, "NtryRef")
            details = ntry.findall("NtryDtls/TxDtls")
            if not details:
                details = [None]
            for idx, tx in enumerate(details):
                amount = Decimal(_t(tx, "Amt") or _t(tx, "AmtDtls/TxAmt/Amt") or (amt_el.text or "0").strip())
                parties = tx.find("RltdPties") if tx is not None else None
                role = "Dbtr" if sign > 0 else "Cdtr"
                name = _party_name(parties, role)
                iban = _t(parties, f"{role}Acct/Id/IBAN")
                ustrd = [u.text.strip() for u in tx.findall("RmtInf/Ustrd") if u.text] if tx is not None else []
                strd = _t(tx, "RmtInf/Strd/CdtrRefInf/Ref")
                remittance = " ".join(ustrd + ([strd] if strd else [])) or _t(ntry, "AddtlNtryInf")
                e2e = _t(tx, "Refs/EndToEndId")
                ref = _t(tx, "Refs/AcctSvcrRef") or _t(tx, "Refs/TxId")
                if not ref and e2e and e2e.upper() != "NOTPROVIDED":
                    ref = e2e
                if not ref and ntry_ref:
                    ref = ntry_ref if len(details) == 1 else f"{ntry_ref}/{idx + 1}"
                out.append(
                    ParsedTxn(
                        booking_date=booking,
                        value_date=value,
                        amount=sign * abs(amount),
                        currency=ccy,
                        counterparty_name=name,
                        counterparty_iban=iban.replace(" ", "").upper(),
                        remittance=remittance,
                        reference=ref,
                        raw={"end_to_end_id": e2e} if e2e else {},
                    )
                )
    return out


# ── SWIFT MT940 ───────────────────────────────────────────────────────────
_TAG = re.compile(r"^:(\d{2}[A-Z]?):", re.M)
_61 = re.compile(
    r"^(?P<vd>\d{6})(?P<ed>\d{4})?(?P<dc>R?[CD])(?P<fc>[A-Z])?(?P<amt>\d+,\d*)"
    r"(?P<type>[NFS][A-Z0-9]{3})(?P<cref>[^/\n]*)(?://(?P<bref>[^\n]*))?",
)
_SUB = re.compile(r"\?(\d{2})")


def _mt_date(yymmdd: str) -> date:
    return date(2000 + int(yymmdd[:2]), int(yymmdd[2:4]), int(yymmdd[4:6]))


def _parse_86(text: str) -> tuple[str, str, str]:
    """Return (name, iban, remittance) from a :86: field (structured ?NN subfields or free text)."""
    flat = text.replace("\r", "").replace("\n", "")
    if not _SUB.search(flat):
        return "", "", " ".join(text.split())
    parts = _SUB.split(flat)
    subs: dict[str, str] = {}
    for code, val in zip(parts[1::2], parts[2::2], strict=False):
        subs[code] = subs.get(code, "") + val
    remit = "".join(subs.get(f"{n:02d}", "") for n in [*range(20, 30), *range(60, 64)])
    name = (subs.get("32", "") + subs.get("33", "")).strip()
    iban = subs.get("31", "").strip().replace(" ", "").upper()
    return name, iban, " ".join(remit.split())


def parse_mt940(data: bytes | str) -> list[ParsedTxn]:
    text = _text(data).replace("\r\n", "\n")
    if ":61:" not in text:
        raise StatementParseError("No :61: statement lines found in MT940 file")
    currency = "EUR"
    out: list[ParsedTxn] = []
    pieces = _TAG.split(text)
    fields = list(zip(pieces[1::2], pieces[2::2], strict=False))
    for i, (tag, body) in enumerate(fields):
        body = body.strip("\n")
        if tag in ("60F", "60M") and len(body) >= 10:
            currency = body[7:10]
        if tag != "61":
            continue
        m = _61.match(body.split("\n", 1)[0])
        if not m:
            raise StatementParseError(f"Malformed :61: line {body[:40]!r}")
        vd = _mt_date(m["vd"])
        booking = vd
        if m["ed"]:
            booking = date(vd.year, int(m["ed"][:2]), int(m["ed"][2:]))
            if (booking - vd).days > 180:
                booking = booking.replace(year=vd.year - 1)
            elif (vd - booking).days > 180:
                booking = booking.replace(year=vd.year + 1)
        amount = Decimal(m["amt"].replace(",", "."))
        dc = m["dc"]
        signed = -amount if dc in ("D", "RC") else amount
        name = iban = remit = ""
        if i + 1 < len(fields) and fields[i + 1][0] == "86":
            name, iban, remit = _parse_86(fields[i + 1][1].strip("\n"))
        bref = (m["bref"] or "").strip()
        cref = (m["cref"] or "").strip()
        ref = bref or (cref if cref.upper() != "NONREF" else "")
        out.append(
            ParsedTxn(
                booking_date=booking, value_date=vd, amount=signed, currency=currency,
                counterparty_name=name, counterparty_iban=iban, remittance=remit,
                # Bank refs repeat across days at some banks; anchor them to the value date.
                reference=f"{vd.isoformat()}:{ref}" if ref else "",
            )
        )
    return out


# ── Generic CSV ───────────────────────────────────────────────────────────
CSV_FIELDS = (
    "date", "value_date", "amount", "debit", "credit", "currency",
    "counterparty_name", "counterparty_iban", "remittance", "reference",
)


def parse_csv(data: bytes | str, mapping: dict[str, Any]) -> list[ParsedTxn]:
    """``mapping``: column header (or 0-based index) per field in CSV_FIELDS plus optional
    ``delimiter``, ``decimal`` (',' or '.'), ``date_format``, ``skip_rows``, ``default_currency``."""
    text = _text(data)
    lines = text.splitlines()[int(mapping.get("skip_rows") or 0):]
    sample = "\n".join(lines[:5])
    delimiter = mapping.get("delimiter")
    if not delimiter:
        counts = {d: sample.count(d) for d in (";", "\t", ",")}
        delimiter = max(counts, key=lambda d: counts[d])
    rows = list(csv.reader(io.StringIO("\n".join(lines)), delimiter=delimiter))
    if not rows:
        raise StatementParseError("CSV file is empty")
    header = [h.strip() for h in rows[0]]

    def col(name: str) -> int | None:
        key = mapping.get(name)
        if key is None or key == "":
            return None
        if isinstance(key, int) or (isinstance(key, str) and key.isdigit()):
            return int(key)
        if key not in header:
            raise StatementParseError(f"Column {key!r} (for {name}) not in header {header}")
        return header.index(key)

    idx = {f: col(f) for f in CSV_FIELDS}
    if idx["date"] is None or (idx["amount"] is None and idx["debit"] is None and idx["credit"] is None):
        raise StatementParseError("Mapping needs a date column and an amount (or debit/credit) column")
    dec = mapping.get("decimal") or None
    fmt = mapping.get("date_format") or None
    default_ccy = (mapping.get("default_currency") or "EUR").upper()

    def get(row: list[str], f: str) -> str:
        i = idx[f]
        return row[i].strip() if i is not None and i < len(row) else ""

    out: list[ParsedTxn] = []
    for n, row in enumerate(rows[1:], start=2):
        if not any(c.strip() for c in row):
            continue
        try:
            if idx["amount"] is not None:
                amount = parse_amount(get(row, "amount"), dec)
            else:
                cr, dr = get(row, "credit"), get(row, "debit")
                amount = (parse_amount(cr, dec) if cr else Decimal(0)) - (abs(parse_amount(dr, dec)) if dr else Decimal(0))
            vd = get(row, "value_date")
            out.append(
                ParsedTxn(
                    booking_date=parse_date(get(row, "date"), fmt),
                    value_date=parse_date(vd, fmt) if vd else None,
                    amount=amount,
                    currency=(get(row, "currency") or default_ccy).upper(),
                    counterparty_name=get(row, "counterparty_name"),
                    counterparty_iban=get(row, "counterparty_iban").replace(" ", "").upper(),
                    remittance=" ".join(get(row, "remittance").split()),
                    reference=get(row, "reference"),
                )
            )
        except StatementParseError as exc:
            raise StatementParseError(f"Row {n}: {exc}") from exc
    return out


def detect_format(data: bytes | str) -> str:
    head = _text(data[:4000] if isinstance(data, bytes) else data[:4000])
    if "camt.054" in head:
        return "camt054"
    if "<Document" in head or "BkToCstmr" in head:
        return "camt053"
    if ":20:" in head and (":61:" in head or ":60F:" in head or ":25:" in head):
        return "mt940"
    return "csv"


def _camt_opening(data: bytes | str) -> tuple[Decimal, date] | None:
    raw = data.encode() if isinstance(data, str) else data
    try:
        root = SafeET.fromstring(raw)
    except Exception:
        return None
    _strip_ns(root)
    stmts = root.findall(".//Stmt")
    if not stmts:
        return None
    # Earliest statement in the file carries the opening balance of the whole period.
    for bal in stmts[0].findall("Bal"):
        if _t(bal, "Tp/CdOrPrtry/Cd") not in ("OPBD", "PRCD"):
            continue
        amt = _t(bal, "Amt")
        when = _date_of(bal, "Dt")
        if not amt or when is None:
            continue
        sign = -1 if _t(bal, "CdtDbtInd") == "DBIT" else 1
        return sign * Decimal(amt), when
    return None


def _mt940_opening(data: bytes | str) -> tuple[Decimal, date] | None:
    m = re.search(r"^:60F:([CD])(\d{6})([A-Z]{3})(\d+,\d*)", _text(data), re.M)
    if not m:
        return None
    amount = Decimal(m[4].replace(",", "."))
    return (-amount if m[1] == "D" else amount), _mt_date(m[2])


def parse_opening_balance(data: bytes | str, fmt: str | None = None) -> tuple[Decimal, date] | None:
    """(amount, date) of the statement's opening balance (camt OPBD/PRCD, MT940 :60F:), else None."""
    fmt = fmt or detect_format(data)
    if fmt == "camt053":
        return _camt_opening(data)
    if fmt == "mt940":
        return _mt940_opening(data)
    return None


def parse_statement(data: bytes | str, fmt: str | None = None, mapping: dict[str, Any] | None = None) -> list[ParsedTxn]:
    fmt = fmt or detect_format(data)
    if fmt in ("camt053", "camt054"):
        return parse_camt(data)
    if fmt == "mt940":
        return parse_mt940(data)
    if fmt == "csv":
        if not mapping:
            raise StatementParseError("CSV import needs a column mapping")
        return parse_csv(data, mapping)
    raise StatementParseError(f"Unknown format {fmt}; expected one of {FORMATS}")
