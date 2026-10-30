"""EPC QR code ("GiroCode") payload for a SEPA credit transfer.

Implements the public EPC069-12 layout, version 002, UTF-8: one field per
line, LF separated, trailing empty fields dropped, at most 331 bytes.
"""

from __future__ import annotations

from decimal import Decimal

MAX_BYTES = 331


class GiroCodeError(ValueError):
    pass


def _iban_ok(iban: str) -> bool:
    if len(iban) < 15 or len(iban) > 34 or not iban[:2].isalpha() or not iban[2:4].isdigit():
        return False
    moved = iban[4:] + iban[:4]
    digits = "".join(str(int(ch, 36)) for ch in moved)
    return int(digits) % 97 == 1


def epc_payload(
    *,
    name: str,
    iban: str,
    amount: Decimal,
    currency: str = "EUR",
    bic: str = "",
    remittance: str = "",
    purpose: str = "",
) -> str:
    """Build the payload; raises ``GiroCodeError`` when the data cannot be encoded."""
    iban = "".join(iban.split()).upper()
    if currency.upper() != "EUR":
        raise GiroCodeError("EPC QR codes carry euro amounts only")
    if not _iban_ok(iban):
        raise GiroCodeError("IBAN check digits do not match")
    name = " ".join(name.split())[:70]
    if not name:
        raise GiroCodeError("beneficiary name is required")
    amount = Decimal(str(amount)).quantize(Decimal("0.01"))
    if amount < Decimal("0.01") or amount > Decimal("999999999.99"):
        raise GiroCodeError("amount out of range")
    fields = [
        "BCD",
        "002",
        "1",
        "SCT",
        bic.replace(" ", "").upper(),
        name,
        iban,
        f"EUR{amount}",
        purpose[:4],
        "",  # structured creditor reference: not used, remittance goes unstructured
        " ".join(remittance.split())[:140],
    ]
    while fields and fields[-1] == "":
        fields.pop()
    payload = "\n".join(fields)
    if len(payload.encode("utf-8")) > MAX_BYTES:
        raise GiroCodeError("payload exceeds 331 bytes")
    return payload
