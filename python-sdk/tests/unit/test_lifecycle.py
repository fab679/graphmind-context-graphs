"""Tests for types/lifecycle.py and core/knowledge_lifecycle.py."""

from graphmind_context_graphs.types.lifecycle import (
    ValidationResult, LifecycleStats, DEFAULT_MIN_SUCCESS_COUNT, DEFAULT_MIN_FAILURE_COUNT,
)


class TestValidationResult:
    def test_success(self):
        r = ValidationResult(trace_id="42", success=True, feedback="Looks good")
        assert r.success is True
        assert r.feedback == "Looks good"

    def test_failure_no_feedback(self):
        r = ValidationResult(trace_id="42", success=False)
        assert r.feedback is None


class TestLifecycleStats:
    def test_defaults(self):
        stats = LifecycleStats()
        assert stats.captured == 0
        assert stats.validated == 0
        assert stats.synthesized == 0
        assert stats.anti_patterns == 0
        assert stats.pruned == 0
        assert stats.total == 0


class TestConstants:
    def test_min_success_count(self):
        assert DEFAULT_MIN_SUCCESS_COUNT == 3

    def test_min_failure_count(self):
        assert DEFAULT_MIN_FAILURE_COUNT == 2
