"""Tests for core/schema_inspector.py — format_schema_for_prompt."""

from graphmind_context_graphs.core.schema_inspector import format_schema_for_prompt
from graphmind_context_graphs.types.data_model import SchemaOverview


class TestFormatSchemaForPrompt:
    def test_empty_schema(self):
        schema = SchemaOverview(node_labels=[], relationship_types=[], node_counts={}, edge_counts={})
        assert format_schema_for_prompt(schema) == ""

    def test_with_entities(self, sample_schema):
        result = format_schema_for_prompt(sample_schema)
        assert "Brain Map" in result
        assert "CodeFile" in result
        assert "10 nodes" in result
        assert "APIEndpoint" in result
        assert "IMPORTS" in result
        assert "15 edges" in result

    def test_with_no_relationships(self):
        schema = SchemaOverview(
            node_labels=["CodeFile"],
            relationship_types=[],
            node_counts={"CodeFile": 5},
            edge_counts={},
        )
        result = format_schema_for_prompt(schema)
        assert "CodeFile" in result
        assert "Entity Types" in result
