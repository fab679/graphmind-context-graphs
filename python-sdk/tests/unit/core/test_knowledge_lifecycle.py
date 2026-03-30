"""Tests for core/knowledge_lifecycle.py."""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from graphmind_context_graphs.core.knowledge_lifecycle import KnowledgeLifecycleManager
from graphmind_context_graphs.types.data_model import (
    DecisionTrace, Intent, Action, Justification,
)
from graphmind_context_graphs.types.lifecycle import ValidationResult, LifecycleStats


def _make_trace(trace_id: str, confidence: float, status: str = "captured") -> DecisionTrace:
    return DecisionTrace(
        id=trace_id,
        intent=Intent(description="test", created_at="now"),
        constraints=[],
        action=Action(description="did it", created_at="now"),
        justification=Justification(description="because", confidence=confidence),
        project="p", tenant="t", status=status,
        created_at="now", updated_at="now",
    )


@pytest.fixture
def mock_store():
    return MagicMock()


@pytest.fixture
def lifecycle(mock_store, resolved_config):
    return KnowledgeLifecycleManager(mock_store, resolved_config)


class TestValidateTrace:
    def test_success_increases_confidence(self, lifecycle, mock_store):
        mock_store.get_trace_by_id.return_value = _make_trace("1", 0.5)
        lifecycle.validate_trace("1", ValidationResult(trace_id="1", success=True))
        mock_store.update_trace_status_and_confidence.assert_called_once_with("1", "validated", 0.6)

    def test_failure_decreases_confidence(self, lifecycle, mock_store):
        mock_store.get_trace_by_id.return_value = _make_trace("1", 0.5)
        lifecycle.validate_trace("1", ValidationResult(trace_id="1", success=False))
        mock_store.update_trace_status_and_confidence.assert_called_once_with("1", "validated", 0.35)

    def test_confidence_capped_at_1(self, lifecycle, mock_store):
        mock_store.get_trace_by_id.return_value = _make_trace("1", 0.95)
        lifecycle.validate_trace("1", ValidationResult(trace_id="1", success=True))
        mock_store.update_trace_status_and_confidence.assert_called_once_with("1", "validated", 1)

    def test_confidence_floored_at_0(self, lifecycle, mock_store):
        mock_store.get_trace_by_id.return_value = _make_trace("1", 0.1)
        lifecycle.validate_trace("1", ValidationResult(trace_id="1", success=False))
        mock_store.update_trace_status_and_confidence.assert_called_once_with("1", "validated", 0)

    def test_raises_for_missing_trace(self, lifecycle, mock_store):
        mock_store.get_trace_by_id.return_value = None
        with pytest.raises(ValueError, match="Trace not found"):
            lifecycle.validate_trace("999", ValidationResult(trace_id="999", success=True))


class TestSynthesizeRules:
    def test_promotes_high_confidence_traces(self, lifecycle, mock_store):
        mock_store.get_candidates_for_synthesis.return_value = [
            _make_trace("1", 0.8, "validated"),
            _make_trace("2", 0.9, "validated"),
        ]
        promoted = lifecycle.synthesize_rules(min_confidence=0.7)
        assert promoted == ["1", "2"]
        assert mock_store.update_trace_status.call_count == 2

    def test_skips_below_threshold(self, lifecycle, mock_store):
        mock_store.get_candidates_for_synthesis.return_value = [
            _make_trace("1", 0.5, "validated"),  # below 0.7
        ]
        promoted = lifecycle.synthesize_rules(min_confidence=0.7)
        assert promoted == []

    def test_empty_candidates(self, lifecycle, mock_store):
        mock_store.get_candidates_for_synthesis.return_value = []
        promoted = lifecycle.synthesize_rules()
        assert promoted == []


class TestPruneFailures:
    def test_marks_as_anti_pattern(self, lifecycle, mock_store):
        mock_store.get_candidates_for_pruning.return_value = ["1", "2"]
        pruned = lifecycle.prune_failures(max_confidence=0.2)
        assert pruned == ["1", "2"]
        assert mock_store.update_trace_status.call_count == 2
        for call in mock_store.update_trace_status.call_args_list:
            assert call[0][1] == "anti_pattern"

    def test_empty(self, lifecycle, mock_store):
        mock_store.get_candidates_for_pruning.return_value = []
        pruned = lifecycle.prune_failures()
        assert pruned == []


class TestSynthesizeSkills:
    def test_not_implemented(self, lifecycle):
        result = lifecycle.synthesize_skills()
        assert result == []


class TestGetLifecycleStats:
    def test_delegates_to_store(self, lifecycle, mock_store):
        expected = LifecycleStats(captured=3, validated=2, total=5)
        mock_store.get_lifecycle_stats.return_value = expected
        stats = lifecycle.get_lifecycle_stats()
        assert stats.captured == 3
        assert stats.total == 5
