# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""A state pack may not state a rule it cannot source.

The Texas and California packs carry tax treatments, wage duties, retainage
caps and statutory deadlines. A user prices work on those figures, so a wrong
one is worse than a missing one: an estimator who sees no retainage rule goes
and looks the cap up, while an estimator who sees the wrong cap bids it.

The rule these tests enforce is therefore not "the number is right" - no test
can know that - but "the number says where it came from and when it started".
Every entry in ``STATE_RULES`` must carry a non-empty ``statute_reference``,
and must carry an ``effective_date`` key whose value is either an ISO date, an
ISO year-month, a bare year, or ``None``. ``None`` is a permitted answer and a
deliberate one, following the convention the payment-clock table already uses
for its null deadlines: it says the commencement was not established, which is
a different statement from "there is no commencement" and from "it started
today". What is not permitted is the key being absent, because then nobody can
tell which of the three was meant.

The second thing these tests hold is the join. A state config names payment
clock regime codes, and the clock has to actually ship them; a rule that points
at a regime the seeder never creates is a dangling reference that no page would
show as broken. So the codes are checked against ``REGIME_CODES``, both ways.

Pure dict and filesystem work. No database, no app bootstrapping, no fixtures,
so nothing here can be skipped by a database marker and quietly take a whole
file's coverage with it.
"""

from __future__ import annotations

import importlib.util
import json
import re
import tomllib
from pathlib import Path
from typing import Any

import pytest

from app.modules.payment_clock.data import PAYMENT_REGIMES, REGIME_CODES
from app.modules.us_ca_pack.config import PACK_CONFIG as CA_CFG
from app.modules.us_ca_pack.config import STATE_RULES as CA_RULES
from app.modules.us_tx_pack.config import PACK_CONFIG as TX_CFG
from app.modules.us_tx_pack.config import STATE_RULES as TX_RULES

# backend/tests/unit/<this file> -> repo root.
_REPO_ROOT = Path(__file__).resolve().parents[3]
_PACKS_DIR = _REPO_ROOT / "packs"

# An ISO date, an ISO year-month, or a bare year. Anything less precise than a
# year is not a date and anything more precise than a day is not one either.
_EFFECTIVE_DATE_RX = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?$")

_STATES: list[tuple[str, dict[str, Any], dict[str, list[dict[str, Any]]], str]] = [
    ("TX", TX_CFG, TX_RULES, "us-texas"),
    ("CA", CA_CFG, CA_RULES, "us-california"),
]

# Every rule dict, flattened to (state, topic, rule) so a failure names the one
# entry that broke rather than the whole topic.
_ALL_RULES: list[tuple[str, str, dict[str, Any]]] = [
    (state, topic, rule)
    for state, _cfg, rules, _slug in _STATES
    for topic, entries in rules.items()
    for rule in entries
]

_US_REGIME_CODES = ("us_tx_public_2251", "us_tx_private_ch28", "us_ca_public_20104", "us_ca_private_8800")


def _rule_id(item: tuple[str, str, dict[str, Any]]) -> str:
    state, topic, rule = item
    return f"{state}.{topic}.{rule.get('code', '<no code>')}"


# ── The sweep has to reach something ───────────────────────────────────────────


def test_both_states_carry_rules() -> None:
    """A sweep that reached no rule is not a clean sweep."""
    assert len(_STATES) == 2, "expected exactly the Texas and California configs"
    for state, _cfg, rules, _slug in _STATES:
        assert rules, f"{state} carries no state rules at all"


def test_enough_rules_to_be_worth_shipping() -> None:
    """Guards against a config being gutted to nothing and still passing."""
    assert len(_ALL_RULES) >= 40, (
        f"only {len(_ALL_RULES)} state rules found across both packs. "
        "Either a topic was dropped or a config stopped exporting STATE_RULES."
    )


# ── Sourcing: the rule these packs exist to keep ───────────────────────────────


@pytest.mark.parametrize("item", _ALL_RULES, ids=_rule_id)
def test_every_rule_names_its_statute(item: tuple[str, str, dict[str, Any]]) -> None:
    """No rule ships without a citation a reader can go and check."""
    state, topic, rule = item
    reference = rule.get("statute_reference")
    assert isinstance(reference, str) and reference.strip(), (
        f"{state} rule {rule.get('code')!r} in topic {topic!r} has no statute_reference. "
        "A tax, wage, retainage or deadline figure without a citation must not ship: "
        "drop the rule and report it as a gap instead."
    )


@pytest.mark.parametrize("item", _ALL_RULES, ids=_rule_id)
def test_every_rule_states_an_effective_date_or_says_it_could_not(
    item: tuple[str, str, dict[str, Any]],
) -> None:
    """The key is always present; ``None`` is an answer, a missing key is not."""
    state, topic, rule = item
    assert "effective_date" in rule, (
        f"{state} rule {rule.get('code')!r} in topic {topic!r} has no effective_date key. "
        "Carry None to say the commencement was not established; omitting the key "
        "leaves a reader unable to tell that from an oversight."
    )
    value = rule["effective_date"]
    if value is None:
        return
    assert isinstance(value, str) and _EFFECTIVE_DATE_RX.match(value), (
        f"{state} rule {rule.get('code')!r} has effective_date {value!r}, which is not an "
        "ISO date, year-month or year. Write the precision that is actually established "
        "rather than padding a year out to a day."
    )


@pytest.mark.parametrize("item", _ALL_RULES, ids=_rule_id)
def test_every_rule_has_a_code_and_a_name(item: tuple[str, str, dict[str, Any]]) -> None:
    """Codes are how the rest of the tree refers to a rule, so they are required."""
    state, topic, rule = item
    for field in ("code", "name", "description"):
        value = rule.get(field)
        assert isinstance(value, str) and value.strip(), f"{state} rule in topic {topic!r} has an empty {field!r}"


def test_rule_codes_are_unique_within_a_state() -> None:
    """A duplicated code makes one of the two rules unreachable by name."""
    for state, _cfg, rules, _slug in _STATES:
        codes = [rule["code"] for entries in rules.values() for rule in entries]
        duplicates = sorted({code for code in codes if codes.count(code) > 1})
        assert not duplicates, f"{state} repeats rule code(s): {duplicates}"


@pytest.mark.parametrize("item", _ALL_RULES, ids=_rule_id)
def test_numeric_values_are_strings_not_floats(item: tuple[str, str, dict[str, Any]]) -> None:
    """Money and rates are strings here, in line with the platform convention."""
    state, _topic, rule = item
    value = rule.get("value")
    assert value is None or isinstance(value, str), (
        f"{state} rule {rule.get('code')!r} carries value {value!r} as {type(value).__name__}. "
        "Rates and money are Decimal-as-string in this tree, never float."
    )


# ── The dated rules are dated because they recently moved ──────────────────────


def test_the_rules_that_changed_recently_carry_the_date_they_changed() -> None:
    """These four are the ones a stale pack would get wrong, so pin their dates.

    Each of them replaced a different rule on a known day. A pack that carried
    the figure without the date would read as always having been true, and the
    2026 private retention cap in particular does not apply to an agreement
    signed the day before it.
    """
    expected = {
        ("TX", "tx_public_retainage_cap_below_threshold"): "2021-06-15",
        ("TX", "tx_lien_affidavit_nonresidential"): "2022-01-01",
        ("CA", "ca_private_retention_cap"): "2026-01-01",
        ("CA", "ca_public_retention_cap"): "2012-01-01",
    }
    found = {(state, rule["code"]): rule["effective_date"] for state, _topic, rule in _ALL_RULES}
    for key, date_value in expected.items():
        assert key in found, f"rule {key[1]!r} is gone from the {key[0]} pack; it carried a dated change"
        assert found[key] == date_value, f"rule {key[1]!r} should carry effective_date {date_value}, got {found[key]!r}"


def test_texas_retainage_caps_switch_at_one_threshold() -> None:
    """The two caps are one rule split in two, so they must agree on the split."""
    caps = {rule["code"]: rule for _s, topic, rule in _ALL_RULES if topic == "retainage" and _s == "TX"}
    below = caps["tx_public_retainage_cap_below_threshold"]
    at_or_above = caps["tx_public_retainage_cap_at_or_above_threshold"]

    assert (
        below["applies_when_contract_value_usd_below"] == at_or_above["applies_when_contract_value_usd_at_or_above"]
    ), (
        "the two Texas retainage bands must meet at the same contract value, "
        "otherwise a contract lands in a gap or in both bands"
    )
    assert below["value"] == "10"
    assert at_or_above["value"] == "5"


def test_california_private_cap_is_not_claimed_for_public_work() -> None:
    """The 2026 cap is a Civil Code rule and does not restate the public one."""
    private_cap = next(rule for _s, _t, rule in _ALL_RULES if rule["code"] == "ca_private_retention_cap")
    public_cap = next(rule for _s, _t, rule in _ALL_RULES if rule["code"] == "ca_public_retention_cap")

    assert "Civil Code" in private_cap["statute_reference"]
    assert "Public Contract Code" in public_cap["statute_reference"]
    assert private_cap["effective_date"] != public_cap["effective_date"], (
        "the private and public caps commenced fourteen years apart; equal dates means one was copied"
    )


# ── The join to the payment clock ──────────────────────────────────────────────


def test_payment_clock_ships_the_regimes_the_state_packs_name() -> None:
    """A config that names a regime the clock never seeds is a dangling reference."""
    for state, cfg, _rules, _slug in _STATES:
        for code in cfg["payment_clock_regimes"]:
            assert code in REGIME_CODES, (
                f"{state} names payment clock regime {code!r}, which the clock does not ship. "
                f"Known codes: {sorted(REGIME_CODES)}"
            )


def test_rules_that_point_at_a_regime_point_at_a_real_one() -> None:
    """Same check one level down, on the individual prompt-payment rules."""
    for state, _topic, rule in _ALL_RULES:
        code = rule.get("payment_clock_regime")
        if code is None:
            continue
        assert code in REGIME_CODES, f"{state} rule {rule['code']!r} points at unknown payment clock regime {code!r}"


def test_every_us_regime_is_claimed_by_a_state_pack() -> None:
    """The reverse direction: a US regime nobody names is a regime nobody reaches."""
    claimed = {code for _s, cfg, _r, _slug in _STATES for code in cfg["payment_clock_regimes"]}
    for code in _US_REGIME_CODES:
        assert code in claimed, f"payment clock regime {code!r} is shipped but no state pack names it"


@pytest.mark.parametrize("code", _US_REGIME_CODES)
def test_us_regimes_are_well_formed(code: str) -> None:
    """The four new regimes obey the table's own conventions."""
    regime = next(entry for entry in PAYMENT_REGIMES if entry["code"] == code)

    assert regime["country_code"] == "US"
    assert regime["statute"].strip(), f"{code} has no statute"
    assert regime["statute_reference"].strip(), f"{code} has no statute_reference"
    # None of the US prompt payment statutes splits a due date from a final
    # date, so all four follow the house convention for single-date regimes.
    assert regime["due_date_basis"] == "application_date"
    assert regime["due_date_days"] == 0
    assert regime["final_date_days"] > 0, f"{code} must impose a payment period"
    # A regime whose final date landed on or before its due date would make
    # every application overdue on arrival.
    assert regime["final_date_days"] > regime["due_date_days"]
    # No US regime here has a notice sequence with a preclusive effect, so
    # silence must not be reported as making the applied sum payable.
    assert regime["no_notice_effect"] == "none", (
        f"{code} claims a no-notice consequence; none of these statutes has one, "
        "and reporting one would tell a user a sum is payable when it is not"
    )


def test_us_regimes_state_an_interest_rate_they_can_render() -> None:
    """A fixed-rate regime needs the fixed figure, a margin regime needs both parts."""
    for code in _US_REGIME_CODES:
        regime = next(entry for entry in PAYMENT_REGIMES if entry["code"] == code)
        basis = regime["interest_basis"]
        if basis == "fixed_rate":
            assert regime["interest_fixed_percent"] is not None, f"{code} is fixed_rate with no fixed percent"
        elif basis == "reference_rate_plus_margin":
            assert regime["interest_reference_rate"].strip(), f"{code} names no reference rate"
            assert regime["interest_margin_percent"] is not None, f"{code} names no margin"
        else:  # pragma: no cover - a new basis should be considered, not defaulted
            pytest.fail(f"{code} uses interest basis {basis!r}, which this test has not been taught to check")
        assert regime["interest_statute"].strip(), f"{code} states interest with no statute behind it"


def test_regime_codes_stay_unique_after_the_us_additions() -> None:
    """Adding four entries must not collide with the eleven already there."""
    assert len(set(REGIME_CODES)) == len(REGIME_CODES), "duplicate payment regime code"


# ── The distributable packs on disk ────────────────────────────────────────────


def _pack_dir(slug: str) -> Path:
    return _PACKS_DIR / slug


def _pkg_dir(slug: str) -> Path:
    src = _pack_dir(slug) / "src"
    packages = sorted(src.glob("openbusinesserp_*"))
    assert len(packages) == 1, f"{slug} should hold exactly one package dir, found {[p.name for p in packages]}"
    return packages[0]


def _load_pack_manifest(slug: str) -> Any:
    """Load a pack's MANIFEST the way the core's filesystem discovery does."""
    manifest_path = _pkg_dir(slug) / "manifest.py"
    spec = importlib.util.spec_from_file_location(f"_oe_test_pack_{slug.replace('-', '_')}", manifest_path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.MANIFEST














# ── The national pack keeps its own job ────────────────────────────────────────


def test_state_packs_do_not_redeclare_vat() -> None:
    """No federal VAT, so the empty dict stays the explicit opt-out signal."""
    for state, cfg, _rules, _slug in _STATES:
        assert cfg["vat_rates"] == {}, f"{state} declares VAT rates; the United States has no federal VAT"


def test_state_packs_declare_their_parent() -> None:
    """A state pack is depth on the national one, and says so."""
    for state, cfg, _rules, _slug in _STATES:
        assert cfg["parent_pack"] == "oe_us_pack", f"{state} does not name the national pack as its parent"
        assert cfg["countries"] == ["US"]
        # The two codes say the same thing in two vocabularies and must not
        # drift apart: region_code is the internal underscore form the other
        # packs use, subdivision_code is ISO 3166-2.
        assert cfg["region_code"] == f"US_{state}", f"{state} region_code is not the house underscore form"
        assert cfg["subdivision_code"] == f"US-{state}", f"{state} subdivision_code is not the ISO 3166-2 code"
