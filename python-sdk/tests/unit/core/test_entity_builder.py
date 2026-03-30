"""Tests for core/entity_builder.py — input validation models."""

from graphmind_context_graphs.core.entity_builder import (
    CreateEntityInput, CreateRelationshipInput, FindEntitiesInput,
)


class TestCreateEntityInput:
    def test_basic(self):
        inp = CreateEntityInput(label="CodeFile")
        assert inp.label == "CodeFile"
        assert inp.reason is None

    def test_extra_fields(self):
        inp = CreateEntityInput(label="CodeFile", path="/src/main.py", language="python")
        assert inp.label == "CodeFile"
        # Extra fields should be allowed via ConfigDict(extra="allow")
        assert inp.path == "/src/main.py"
        assert inp.language == "python"


class TestCreateRelationshipInput:
    def test_basic(self):
        inp = CreateRelationshipInput(source_id="1", target_id="2", relationship_type="IMPORTS")
        assert inp.source_id == "1"
        assert inp.target_id == "2"
        assert inp.relationship_type == "IMPORTS"
        assert inp.reason is None


class TestFindEntitiesInput:
    def test_basic(self):
        inp = FindEntitiesInput(label="CodeFile")
        assert inp.filter is None

    def test_with_filter(self):
        inp = FindEntitiesInput(label="CodeFile", filter={"language": "python"})
        assert inp.filter == {"language": "python"}
