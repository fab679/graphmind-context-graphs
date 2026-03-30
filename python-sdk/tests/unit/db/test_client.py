"""Tests for db/client.py — GraphmindStore with mocked GraphmindClient."""

from __future__ import annotations

from unittest.mock import MagicMock, patch, ANY

import pytest

from graphmind_context_graphs.db.client import GraphmindStore, _reconstruct_trace, _props
from graphmind_context_graphs.types.data_model import (
    DecisionTrace, Intent, Action, Constraint, Justification,
    ScoredDecisionTrace, SchemaOverview, GraphEntity, GraphRelationship, ToolCallRecord,
)
from graphmind_context_graphs.types.lifecycle import LifecycleStats


@pytest.fixture
def store(resolved_config):
    with patch("graphmind_context_graphs.db.client.GraphmindClient") as MockClient:
        mock_client = MagicMock()
        MockClient.connect.return_value = mock_client

        empty = MagicMock()
        empty.records = []
        empty.columns = []
        mock_client.query.return_value = empty
        mock_client.query_readonly.return_value = empty

        s = GraphmindStore(resolved_config)
        s._client = mock_client
        yield s


class TestStoreInit:
    def test_graph_namespace(self, store):
        assert store.graph_name == "cg_test_tenant"

    def test_project(self, store):
        assert store.project == "test_project"

    def test_tenant(self, store):
        assert store.tenant == "test_tenant"

    def test_agent_name(self, store):
        assert store.agent_name == "test-agent"


class TestEnsureMethods:
    def test_ensure_project(self, store):
        store.ensure_project()
        store._client.query.assert_called()

    def test_ensure_project_with_description(self, store):
        store.ensure_project(description="My project")
        call_args = store._client.query.call_args
        assert "description" in call_args.kwargs.get("params", call_args[1].get("params", {}))

    def test_ensure_domain(self, store):
        store.ensure_domain("finance")
        store._client.query.assert_called()

    def test_ensure_agent(self, store):
        store.ensure_agent("my-agent")
        # Should call merge agent + link to project
        assert store._client.query.call_count >= 2

    def test_ensure_tool(self, store):
        store.ensure_tool("search")
        store._client.query.assert_called_once()

    def test_ensure_concept_simple(self, store):
        store.ensure_concept("auth")
        store._client.query.assert_called_once()

    def test_ensure_concept_with_embedding(self, store):
        store.ensure_concept("auth", embedding=[0.1, 0.2])
        # merge_concept + update_concept_embedding
        assert store._client.query.call_count == 2

    def test_ensure_methods_swallow_errors(self, store):
        store._client.query.side_effect = Exception("DB error")
        # None of these should raise
        store.ensure_project()
        store.ensure_domain("d")
        store.ensure_agent("a")
        store.ensure_tool("t")
        store.ensure_concept("c")


class TestSaveDecisionTrace:
    def test_returns_trace_id(self, store, sample_trace):
        create_result = MagicMock()
        create_result.records = [[42]]
        store._client.query.return_value = create_result

        trace_id = store.save_decision_trace(sample_trace)
        assert trace_id == "42"

    def test_links_to_project_domain_agent(self, store, sample_trace):
        create_result = MagicMock()
        create_result.records = [[1]]
        store._client.query.return_value = create_result

        store.save_decision_trace(sample_trace)

        all_queries = [str(c) for c in store._client.query.call_args_list]
        # Should have multiple query calls for linking
        assert store._client.query.call_count > 1

    def test_creates_constraints(self, store, sample_trace):
        create_result = MagicMock()
        create_result.records = [[1]]
        store._client.query.return_value = create_result

        store.save_decision_trace(sample_trace)

        # Check that constraint creation was attempted
        constraint_calls = [
            c for c in store._client.query.call_args_list
            if "constraint" in str(c).lower() or "Constraint" in str(c)
        ]
        assert len(constraint_calls) >= 1


class TestFindSimilarTraces:
    def test_shared_policy(self, store):
        result = store.find_similar_traces([0.1, 0.2, 0.3, 0.4])
        store._client.query_readonly.assert_called_once()
        assert result == []

    def test_isolated_policy(self, resolved_config):
        resolved_config.context_sharing = "isolated"
        with patch("graphmind_context_graphs.db.client.GraphmindClient") as MockClient:
            mock_client = MagicMock()
            MockClient.connect.return_value = mock_client
            empty = MagicMock()
            empty.records = []
            mock_client.query.return_value = empty
            mock_client.query_readonly.return_value = empty

            s = GraphmindStore(resolved_config)
            s._client = mock_client
            s.find_similar_traces([0.1])
            query_str = str(mock_client.query_readonly.call_args)
            assert "agent" in query_str.lower() or mock_client.query_readonly.called

    def test_handles_search_error(self, store):
        store._client.query_readonly.side_effect = Exception("Search failed")
        result = store.find_similar_traces([0.1])
        assert result == []


class TestLifecycleQueries:
    def test_update_trace_status(self, store):
        store.update_trace_status("42", "validated")
        store._client.query.assert_called_once()
        params = store._client.query.call_args.kwargs.get("params", store._client.query.call_args[1].get("params", {}))
        assert params["traceId"] == 42
        assert params["status"] == "validated"

    def test_update_trace_confidence(self, store):
        store.update_trace_confidence("42", 0.85)
        params = store._client.query.call_args.kwargs.get("params", store._client.query.call_args[1].get("params", {}))
        assert params["confidence"] == 0.85

    def test_count_traces(self, store):
        result = MagicMock()
        result.records = [[5]]
        store._client.query_readonly.return_value = result
        assert store.count_traces() == 5

    def test_count_traces_empty(self, store):
        assert store.count_traces() == 0

    def test_get_lifecycle_stats(self, store):
        result = MagicMock()
        result.records = [["captured", 3], ["validated", 2], ["synthesized", 1]]
        store._client.query_readonly.return_value = result

        stats = store.get_lifecycle_stats()
        assert stats.captured == 3
        assert stats.validated == 2
        assert stats.synthesized == 1
        assert stats.total == 6

    def test_get_lifecycle_stats_empty(self, store):
        stats = store.get_lifecycle_stats()
        assert stats.total == 0

    def test_get_trace_ids_by_status(self, store):
        result = MagicMock()
        result.records = [[1], [2], [3]]
        store._client.query_readonly.return_value = result

        ids = store.get_trace_ids_by_status("captured")
        assert ids == ["1", "2", "3"]


class TestGetActiveRules:
    def test_shared_policy(self, store):
        store.get_active_rules()
        store._client.query_readonly.assert_called_once()

    def test_isolated_uses_agent_query(self, resolved_config):
        resolved_config.context_sharing = "isolated"
        with patch("graphmind_context_graphs.db.client.GraphmindClient") as MockClient:
            mock_client = MagicMock()
            MockClient.connect.return_value = mock_client
            empty = MagicMock()
            empty.records = []
            mock_client.query_readonly.return_value = empty
            mock_client.query.return_value = empty

            s = GraphmindStore(resolved_config)
            s._client = mock_client
            s.get_active_rules()
            params = mock_client.query_readonly.call_args.kwargs.get("params", mock_client.query_readonly.call_args[1].get("params", {}))
            assert "agentName" in params


class TestGetAntiPatterns:
    def test_basic(self, store):
        store.get_anti_patterns()
        store._client.query_readonly.assert_called_once()


class TestEntityManagement:
    def test_create_entity(self, store):
        result = MagicMock()
        result.records = [[99]]
        store._client.query.return_value = result

        entity = GraphEntity(label="CodeFile", properties={"path": "/main.py"}, created_at="now")
        eid = store.create_entity(entity)
        assert eid == "99"

    def test_create_entity_with_agent(self, store):
        result = MagicMock()
        result.records = [[100]]
        store._client.query.return_value = result

        entity = GraphEntity(label="CodeFile", properties={"path": "/main.py"}, created_at="now", created_by="test-agent")
        store.create_entity(entity)
        # Should have extra calls for agent linking
        assert store._client.query.call_count > 1

    def test_create_relationship(self, store):
        store.create_relationship(GraphRelationship(
            source_id="1", target_id="2", type="IMPORTS", created_at="now",
        ))
        store._client.query.assert_called_once()

    def test_find_entities_empty(self, store):
        result = store.find_entities("CodeFile")
        assert result == []


class TestSchemaOverview:
    def test_empty_schema(self, store):
        schema = store.get_schema_overview()
        assert schema.node_labels == []
        assert schema.relationship_types == []

    def test_filters_framework_types(self):
        node_result = MagicMock()
        node_result.records = [
            [["DecisionTrace"], 5],  # framework — filtered
            [["CodeFile"], 10],      # domain — kept
            [["Agent"], 2],          # framework — filtered
        ]
        rel_result = MagicMock()
        rel_result.records = [
            ["HAS_INTENT", 5],       # framework — filtered
            ["IMPORTS", 15],         # domain — kept
        ]

        schema = GraphmindStore._build_schema(node_result, rel_result)
        assert "CodeFile" in schema.node_labels
        assert "DecisionTrace" not in schema.node_labels
        assert "Agent" not in schema.node_labels
        assert "IMPORTS" in schema.relationship_types
        assert "HAS_INTENT" not in schema.relationship_types


class TestProps:
    def test_dict_with_properties(self):
        assert _props({"properties": {"name": "x"}}) == {"name": "x"}

    def test_dict_without_properties(self):
        assert _props({"name": "x"}) == {"name": "x"}

    def test_non_dict(self):
        assert _props("not a dict") == {}

    def test_none(self):
        assert _props(None) == {}
