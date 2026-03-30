"""Tests for db/queries.py — query templates and vector search builders."""

from graphmind_context_graphs.db.queries import (
    SCHEMA_QUERIES, PROJECT_QUERIES, DOMAIN_QUERIES, AGENT_QUERIES,
    CONCEPT_QUERIES, TOOL_QUERIES, SKILL_QUERIES, TRACE_QUERIES,
    create_vector_index, search_similar_traces_query, search_similar_traces_by_agents_query,
)


class TestSchemaQueries:
    def test_all_present(self):
        expected = [
            "create_intent_index", "create_constraint_index", "create_action_index",
            "create_trace_index", "create_project_index", "create_domain_index",
            "create_concept_index", "create_tool_index", "create_agent_index", "create_skill_index",
        ]
        for name in expected:
            assert name in SCHEMA_QUERIES

    def test_index_queries_contain_if_not_exists(self):
        for q in SCHEMA_QUERIES.values():
            assert "IF NOT EXISTS" in q


class TestCreateVectorIndex:
    def test_basic(self):
        q = create_vector_index("my_idx", "MyLabel", 768, "cosine")
        assert "CREATE VECTOR INDEX my_idx IF NOT EXISTS" in q
        assert "MyLabel" in q
        assert "768" in q
        assert "cosine" in q

    def test_different_metric(self):
        q = create_vector_index("idx", "Node", 1536, "l2")
        assert "l2" in q


class TestProjectQueries:
    def test_has_merge_and_simple(self):
        assert "merge_project" in PROJECT_QUERIES
        assert "merge_project_simple" in PROJECT_QUERIES

    def test_merge_uses_merge(self):
        assert "MERGE" in PROJECT_QUERIES["merge_project"]


class TestDomainQueries:
    def test_has_keys(self):
        assert "merge_domain" in DOMAIN_QUERIES
        assert "merge_domain_simple" in DOMAIN_QUERIES


class TestAgentQueries:
    def test_has_keys(self):
        expected = ["merge_agent", "merge_agent_simple", "link_agent_to_project",
                     "link_agent_to_domain", "get_agents_by_project"]
        for k in expected:
            assert k in AGENT_QUERIES


class TestConceptQueries:
    def test_has_keys(self):
        expected = ["merge_concept", "merge_concept_simple", "update_concept_embedding",
                     "link_trace_to_concept", "get_traces_by_concept", "get_concepts_by_project"]
        for k in expected:
            assert k in CONCEPT_QUERIES


class TestToolQueries:
    def test_has_keys(self):
        assert "merge_tool" in TOOL_QUERIES
        assert "link_trace_to_tool" in TOOL_QUERIES
        assert "get_tool_stats_by_project" in TOOL_QUERIES


class TestSkillQueries:
    def test_has_keys(self):
        expected = ["merge_skill", "link_skill_to_project", "link_skill_to_concept",
                     "link_skill_to_domain", "link_trace_to_skill", "get_skills_by_project",
                     "get_skill_by_name", "get_synthesized_traces_with_concepts"]
        for k in expected:
            assert k in SKILL_QUERIES


class TestTraceQueries:
    def test_has_all_keys(self):
        expected = [
            "create_decision_trace", "link_trace_to_project", "link_trace_to_domain",
            "link_trace_to_agent", "create_constraint_for_trace", "get_trace_by_id",
            "update_trace_status", "update_trace_confidence", "update_trace_status_and_confidence",
            "get_active_rules", "get_active_rules_by_agent", "get_anti_patterns",
            "get_anti_patterns_by_agent", "create_precedent_link", "count_traces_by_project",
            "get_lifecycle_stats", "get_trace_ids_by_status",
            "get_candidates_for_synthesis", "get_candidates_for_pruning",
        ]
        for k in expected:
            assert k in TRACE_QUERIES


class TestSearchSimilarTracesQuery:
    def test_contains_vector_search(self):
        q = search_similar_traces_query("[0.1, 0.2]", 5)
        assert "VECTOR INDEX trace_embedding" in q
        assert "LIMIT 5" in q
        assert "$project" in q

    def test_different_limit(self):
        q = search_similar_traces_query("[0.1]", 10)
        assert "LIMIT 10" in q


class TestSearchSimilarTracesByAgentsQuery:
    def test_contains_agent_filter(self):
        q = search_similar_traces_by_agents_query("[0.1]", 5, ["agent-a", "agent-b"])
        assert '"agent-a"' in q
        assert '"agent-b"' in q
        assert "ag.name IN" in q

    def test_single_agent(self):
        q = search_similar_traces_by_agents_query("[0.1]", 3, ["solo"])
        assert '"solo"' in q
        assert "LIMIT 3" in q
