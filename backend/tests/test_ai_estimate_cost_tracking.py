# DDC-CWICR-OE: DataDrivenConstruction · OpenBusinessERP
# Copyright (c) 2026 Artem Boiko / DataDrivenConstruction
"""ai_estimate — cost-tracking pure-arithmetic tests.

The ``ai`` module writes ``cost_usd_estimate`` using the
shared per-1k rate table in :mod:`app.core.ai.pricing`. These tests pin
the contract:

* zero / negative tokens → 0 USD
* unknown model → falls back to ``DEFAULT_COST_PER_1K``
* known model → uses the table rate (tokens / 1000 * rate)

Pure arithmetic only — no DB / no LLM. For the ``ai`` estimate module
we additionally check schema parity: the response model
exposes ``cost_usd_estimate`` and the column exists on the ORM model.
"""

from __future__ import annotations

from decimal import Decimal

import pytest

# ── Pure helper: cost arithmetic ───────────────────────────────────────────


class TestEstimateCostUsdShared:
    """Contract of the shared per-1k cost helper."""

    def test_zero_tokens_zero_cost(self) -> None:
        from app.core.ai.pricing import estimate_cost_usd

        assert estimate_cost_usd("claude-haiku-4-5", 0) == Decimal("0.0")
        assert estimate_cost_usd("claude-sonnet", 0) == Decimal("0.0")
        # Negative tokens (defensive against bad provider responses) also
        # collapse to 0 instead of producing a negative-cost row.
        assert estimate_cost_usd("claude-haiku-4-5", -100) == Decimal("0.0")

    def test_known_model_uses_table_rate(self) -> None:
        from app.core.ai.pricing import MODEL_COSTS, estimate_cost_usd

        # 3000 tokens against the haiku rate (0.0024 per 1k) → 0.0072
        result = estimate_cost_usd("claude-haiku-4-5", 3000)
        assert result == MODEL_COSTS["claude-haiku-4-5"] * Decimal(3)
        assert result == Decimal("0.0072")

    def test_unknown_model_uses_default_rate(self) -> None:
        from app.core.ai.pricing import DEFAULT_COST_PER_1K, estimate_cost_usd

        # 1000 tokens against DEFAULT_COST_PER_1K (0.0020) → 0.0020
        result = estimate_cost_usd("some-unreleased-model-2027", 1000)
        assert result == DEFAULT_COST_PER_1K

    def test_empty_or_none_model_uses_default_rate(self) -> None:
        from app.core.ai.pricing import DEFAULT_COST_PER_1K, estimate_cost_usd

        # Defensive: when the provider didn't report a model name (early
        # mock failure path) we still want a sensible non-zero cost so
        # the row's cost column is monotone with token count.
        assert estimate_cost_usd("", 500) == DEFAULT_COST_PER_1K / Decimal(2)
        assert estimate_cost_usd(None, 500) == DEFAULT_COST_PER_1K / Decimal(2)

    def test_decimal_arithmetic_no_float_drift(self) -> None:
        from app.core.ai.pricing import estimate_cost_usd

        # Asking for an awkward token count must stay in Decimal so we
        # don't get binary-float rounding artefacts at persist time.
        result = estimate_cost_usd("claude-haiku-4-5", 1234)
        assert isinstance(result, Decimal)
        # 1234/1000 * 0.0024 = 0.0029616 exact
        assert result == Decimal("0.0029616")


# ── Schema / model parity ──────────────────────────────────────────────────


class TestAIEstimateJobSchemaHasCostField:
    """Pydantic + ORM expose cost_usd_estimate."""

    def test_pydantic_response_has_cost_field(self) -> None:
        from app.modules.ai.schemas import EstimateJobResponse

        assert "cost_usd_estimate" in EstimateJobResponse.model_fields
        field = EstimateJobResponse.model_fields["cost_usd_estimate"]
        # Float type, defaults to 0.0 for backward-compat with rows
        # that pre-date the cost-tracking migration.
        assert field.default == 0.0

    def test_orm_model_has_cost_column(self) -> None:
        from app.modules.ai.models import AIEstimateJob

        assert hasattr(AIEstimateJob, "cost_usd_estimate")
        col = AIEstimateJob.__table__.c.cost_usd_estimate
        assert col.nullable is False
        # server_default ensures fresh-install create_all path does not
        # IntegrityError on the NOT NULL column (post-v4.4.1 discipline).
        assert col.server_default is not None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
