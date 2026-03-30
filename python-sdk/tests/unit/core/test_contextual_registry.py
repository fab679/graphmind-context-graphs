"""Tests for core/contextual_registry.py."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from graphmind_context_graphs.core.contextual_registry import ContextualRegistry
from graphmind_context_graphs.types.data_model import (
    DecisionTrace, Intent, Action, Constraint, Justification,
    ScoredDecisionTrace, FormattedContext, SchemaOverview,
)


@pytest.fixture
def mock_store():
    store = MagicMock()
    store.count_traces.return_value = 0
    store.find_similar_traces.return_value = []
    store.get_active_rules.return_value = []
    store.get_anti_patterns.return_value = []
    store.get_skills_by_project.return_value = []
    store.get_schema_overview.return_value = SchemaOverview(
        node_labels=[], relationship_types=[], node_counts={}, edge_counts={},
    )
    store.save_decision_trace.return_value = "1"
    return store


@pytest.fixture
def registry(mock_store, fake_embedding, resolved_config):
    return ContextualRegistry(mock_store, fake_embedding, resolved_config)


class TestDiscoveryMode:
    def test_true_when_no_traces(self, registry, mock_store):
        mock_store.count_traces.return_value = 0
        assert registry.is_discovery_mode() is True

    def test_false_when_traces_exist(self, registry, mock_store):
        mock_store.count_traces.return_value = 5
        # Reset cached value
        registry._discovery_mode = None
        assert registry.is_discovery_mode() is False

    def test_caches_result(self, registry, mock_store):
        mock_store.count_traces.return_value = 0
        registry.is_discovery_mode()
        registry.is_discovery_mode()
        # Should only call count_traces once
        mock_store.count_traces.assert_called_once()


class TestGetRelevantContext:
    def test_returns_formatted_context(self, registry):
        ctx = registry.get_relevant_context("Fix the bug")
        assert isinstance(ctx, FormattedContext)
        assert ctx.past_traces == []
        assert ctx.rules == []
        assert ctx.anti_patterns == []
        assert ctx.skills == []

    def test_calls_embedding(self, registry, fake_embedding):
        registry.get_relevant_context("test intent")
        # The embedding should have been called (indirectly via find_similar_traces)

    def test_passes_embedding_to_store(self, registry, mock_store):
        registry.get_relevant_context("test intent")
        mock_store.find_similar_traces.assert_called_once_with([0.1, 0.2, 0.3, 0.4], 5)


class TestRecordDecision:
    def test_returns_trace_id(self, registry, sample_trace):
        trace_id = registry.record_decision(sample_trace)
        assert trace_id == "1"

    def test_enriches_embeddings(self, registry, mock_store, sample_trace):
        registry.record_decision(sample_trace)
        # The trace should have embedding set when passed to save
        saved_trace = mock_store.save_decision_trace.call_args[0][0]
        assert saved_trace.embedding is not None
        assert saved_trace.intent.embedding is not None
        assert saved_trace.action.embedding is not None

    def test_enriches_constraint_embeddings(self, registry, mock_store, sample_trace):
        registry.record_decision(sample_trace)
        saved_trace = mock_store.save_decision_trace.call_args[0][0]
        assert saved_trace.constraints[0].embedding is not None

    def test_embeds_concepts(self, registry, mock_store, sample_trace):
        registry.record_decision(sample_trace)
        # Should call ensure_concept for each concept
        assert mock_store.ensure_concept.call_count == 2

    def test_links_precedents(self, registry, mock_store, sample_trace):
        scored = ScoredDecisionTrace(
            trace=DecisionTrace(
                id="99",
                intent=Intent(description="similar", created_at="now"),
                constraints=[], action=Action(description="a", created_at="now"),
                justification=Justification(description="j", confidence=0.5),
                project="p", tenant="t", status="captured",
                created_at="now", updated_at="now",
            ),
            similarity=0.9,
        )
        mock_store.find_similar_traces.return_value = [scored]

        registry.record_decision(sample_trace)
        mock_store.create_precedent_link.assert_called()

    def test_resets_discovery_mode(self, registry, sample_trace):
        registry._discovery_mode = True
        registry.record_decision(sample_trace)
        assert registry._discovery_mode is None
