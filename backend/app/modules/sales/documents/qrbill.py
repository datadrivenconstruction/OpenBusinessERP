"""Swiss QR-bill payload (Swiss Implementation Guidelines QR-bill v2.3, SPC 0200, coding 1).

Fields are CR LF separated in the fixed order of the guidelines; only structured
addresses (type S) are produced, since type K is no longer accepted from Nov 2025.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from decimal import Decimal

from app.modules.sales.documents.girocode import _iban_ok

MAX_CHARS = 997
_QRR_TABLE = (0, 9, 4, 6, 8, 2, 7, 1, 3, 5)
# Latin character set allowed by the guidelines (Basic Latin + Latin-1 + a few Latin Extended-A).
_ALLOWED = re.compile(r"^[\x20-\x7e\xa0-\xffŒœŠšŽžŸȘșȚț€]*$")


class QrBillError(ValueError):
    pass


@dataclass(frozen=True)
class Address:
    name: str
    street: str = ""
    building: str = ""
    postcode: str = ""
    town: str = ""
    country: str = "CH"

    def fields(self) -> list[str]:
        return ["S", self.name, self.street, self.building, self.postcode, self.town, self.country]


def compact_iban(iban: str) -> str:
    return "".join(iban.split()).upper()


def is_swiss_iban(iban: str) -> bool:
    iban = compact_iban(iban)
    return len(iban) == 21 and iban[:2] in ("CH", "LI") and _iban_ok(iban)


def is_qr_iban(iban: str) -> bool:
    """QR-IBAN: a CH/LI IBAN whose institution id (positions 5-9) lies in 30000-31999."""
    iban = compact_iban(iban)
    return is_swiss_iban(iban) and iban[4:9].isdigit() and 30000 <= int(iban[4:9]) <= 31999


def qrr_check_digit(digits: str) -> str:
    """Modulo 10 recursive check digit (as for ISR / QR reference)."""
    carry = 0
    for ch in digits:
        carry = _QRR_TABLE[(carry + int(ch)) % 10]
    return str((10 - carry) % 10)


def qrr_reference(value: str) -> str:
    """27-digit QR reference from up to 26 digits of ``value`` (non-digits dropped)."""
    digits = "".join(ch for ch in value if ch.isdigit())
    if not digits or len(digits) > 26 or int(digits) == 0:
        raise QrBillError("QR reference needs 1-26 digits, not all zero")
    body = digits.rjust(26, "0")
    return body + qrr_check_digit(body)


def qrr_valid(ref: str) -> bool:
    return len(ref) == 27 and ref.isdigit() and int(ref) != 0 and qrr_check_digit(ref[:26]) == ref[26]


def _mod97(s: str) -> int:
    return int("".join(str(int(ch, 36)) for ch in s)) % 97


def scor_reference(value: str) -> str:
    """ISO 11649 creditor reference ``RFkk...`` from an alphanumeric base of 1-21 chars."""
    base = "".join(ch for ch in value.upper() if ch.isalnum())
    if not base or len(base) > 21 or not base.isascii():
        raise QrBillError("creditor reference base must be 1-21 alphanumeric characters")
    check = 98 - _mod97(base + "RF00")
    return f"RF{check:02d}{base}"


def scor_valid(ref: str) -> bool:
    ref = ref.replace(" ", "").upper()
    return (
        5 <= len(ref) <= 25
        and ref.startswith("RF")
        and ref[2:4].isdigit()
        and ref.isalnum()
        and ref.isascii()
        and _mod97(ref[4:] + ref[:4]) == 1
    )


def _check_address(a: Address, role: str) -> None:
    limits = {"name": 70, "street": 70, "building": 16, "postcode": 16, "town": 35}
    for key, cap in limits.items():
        v = getattr(a, key)
        if len(v) > cap or not _ALLOWED.match(v):
            raise QrBillError(f"{role} {key} too long or has characters outside the QR-bill set")
    if not a.name or not a.postcode or not a.town:
        raise QrBillError(f"{role} name, postcode and town are required")
    if not re.fullmatch(r"[A-Z]{2}", a.country):
        raise QrBillError(f"{role} country must be an ISO 3166 alpha-2 code")


def qr_bill_payload(
    *,
    creditor: Address,
    iban: str,
    amount: Decimal | None,
    currency: str = "CHF",
    debtor: Address | None = None,
    reference_type: str = "NON",
    reference: str = "",
    message: str = "",
) -> str:
    """Build the QR-bill payload; raises ``QrBillError`` when the data does not conform."""
    iban = compact_iban(iban)
    if not is_swiss_iban(iban):
        raise QrBillError("creditor account must be a valid CH or LI IBAN")
    currency = currency.upper()
    if currency not in ("CHF", "EUR"):
        raise QrBillError("currency must be CHF or EUR")
    _check_address(creditor, "creditor")
    if debtor is not None:
        _check_address(debtor, "debtor")
    amt = ""
    if amount is not None:
        q = Decimal(str(amount)).quantize(Decimal("0.01"))
        if q < Decimal("0.01") or q > Decimal("999999999.99"):
            raise QrBillError("amount out of range 0.01-999999999.99")
        amt = f"{q:.2f}"
    reference = reference.replace(" ", "").upper()
    qr = is_qr_iban(iban)
    if reference_type == "QRR":
        if not qr or not qrr_valid(reference):
            raise QrBillError("QRR needs a QR-IBAN and a valid 27-digit QR reference")
    elif reference_type == "SCOR":
        if qr or not scor_valid(reference):
            raise QrBillError("SCOR needs a regular IBAN and a valid RF creditor reference")
    elif reference_type == "NON":
        if qr or reference:
            raise QrBillError("NON is not allowed with a QR-IBAN and carries no reference")
    else:
        raise QrBillError("reference type must be QRR, SCOR or NON")
    message = " ".join(message.split())
    if len(message) > 140 or not _ALLOWED.match(message):
        raise QrBillError("message longer than 140 characters or has invalid characters")
    fields = [
        "SPC",
        "0200",
        "1",
        iban,
        *creditor.fields(),
        *([""] * 7),  # ultimate creditor: reserved, must stay empty
        amt,
        currency,
        *(debtor.fields() if debtor else [""] * 7),
        reference_type,
        reference,
        message,
        "EPD",
    ]
    payload = "\r\n".join(fields)
    if len(payload) > MAX_CHARS:
        raise QrBillError("payload exceeds 997 characters")
    return payload


_TOWN = re.compile(r"^(?:(CH|LI)[- ])?(\d{4})\s+(.+)$")
_STREET = re.compile(r"^(.*?\D)\s+(\d+\s?[A-Za-z]?(?:[/-]\d+[A-Za-z]?)?)$")


def parse_swiss_address(name: str, address: str) -> Address | None:
    """Best-effort split of a free-text Swiss/Liechtenstein address; ``None`` when unsure."""
    lines = [ln.strip() for ln in (address or "").splitlines() if ln.strip()]
    if not name.strip() or not lines:
        return None
    m = _TOWN.match(lines[-1])
    if not m:
        return None
    country = m.group(1) or ("LI" if 9485 <= int(m.group(2)) <= 9498 else "CH")
    street, building = "", ""
    if len(lines) >= 2:
        s = _STREET.match(lines[-2])
        street, building = (s.group(1).strip(), s.group(2).replace(" ", "")) if s else (lines[-2], "")
    return Address(" ".join(name.split())[:70], street[:70], building[:16], m.group(2), m.group(3)[:35], country)
