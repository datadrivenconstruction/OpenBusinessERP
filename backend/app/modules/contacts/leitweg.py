"""Loose shape check for a Leitweg-ID (BT-10 of an XRechnung to a public buyer)."""

from __future__ import annotations

import re
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.contacts.models import Contact

# Grobadressierung (2-12 digits), optional Feinadressierung (up to 30 letters or
# digits) and two check digits, separated by "-". The check digits are not
# recomputed: a mistyped but well-formed ID is the buyer's portal to reject.
_LEITWEG = re.compile(r"^\d{2,12}(-[0-9A-Z]{1,30})?-\d{2}$")


def normalise_leitweg_id(value: str | None) -> str:
    """Return the ID trimmed and upper-cased; "" for empty input.

    Raises:
        ValueError: when the value is not shaped like a Leitweg-ID.
    """
    text = (value or "").strip().upper()
    if text and not _LEITWEG.match(text):
        raise ValueError("Leitweg-ID must look like 991-01234-44 (digits, optional fine addressing, two check digits)")
    return text


async def contact_leitweg_id(session: AsyncSession, contact_id: Any) -> str:
    """The default Leitweg-ID stored on a contact; "" when there is none."""
    value = (await session.execute(select(Contact.leitweg_id).where(Contact.id == contact_id))).scalar_one_or_none()
    return (value or "").strip()
