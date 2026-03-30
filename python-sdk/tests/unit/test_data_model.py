"""Tests for types/data_model.py — dataclass construction and defaults."""

from graphmind_context_graphs.types.data_model import (
    Intent, Constraint, Action, Justification, ToolCallRecord,
    DecisionTrace, ScoredDecisionTrace, GraphEntity, GraphRelationship,
    SchemaOverview, FormattedContext, Skill, AgentNode, Domain, Project, Concept,
)


class TestIntent:
    def test_basic(self):
        i = Intent(description="Fix bug", created_at="2026-01-01")
        assert i.description == "Fix bug"
        assert i.id is None
        assert i.embedding is None

    def test_with_embedding(self):
        i = Intent(description="Fix bug", created_at="2026-01-01", embedding=[0.1, 0.2])
        assert i.embedding == [0.1, 0.2]


class TestConstraint:
    def test_types(self):
        for t in ("blocker", "permission", "pivot"):
            c = Constraint(description="test", type=t, created_at="2026-01-01")
            assert c.type == t


class TestAction:
    def test_defaults(self):
        a = Action(description="deployed", created_at="2026-01-01")
        assert a.outcome is None
        assert a.embedding is None

    def test_outcomes(self):
        for o in ("success", "failure", "pending"):
            a = Action(description="test", created_at="2026-01-01", outcome=o)
            assert a.outcome == o


class TestJustification:
    def test_basic(self):
        j = Justification(description="because reasons", confidence=0.8)
        assert j.ablation_score is None

    def test_with_ablation(self):
        j = Justification(description="test", confidence=0.5, ablation_score=0.3)
        assert j.ablation_score == 0.3


class TestToolCallRecord:
    def test_defaults(self):
        tc = ToolCallRecord(name="search", args="{}", created_at="2026-01-01")
        assert tc.result is None
        assert tc.duration_ms is None


class TestDecisionTrace:
    def test_full_construction(self, sample_trace):
        assert sample_trace.intent.description == "Fix the login bug"
        assert len(sample_trace.constraints) == 1
        assert sample_trace.action.outcome == "success"
        assert sample_trace.status == "captured"
        assert sample_trace.concepts == ["authentication", "sso"]
        assert len(sample_trace.tool_calls) == 1

    def test_minimal(self):
        t = DecisionTrace(
            intent=Intent(description="test", created_at="now"),
            constraints=[],
            action=Action(description="did it", created_at="now"),
            justification=Justification(description="because", confidence=0.5),
            project="p", tenant="t", status="captured",
            created_at="now", updated_at="now",
        )
        assert t.id is None
        assert t.tool_calls is None
        assert t.domain is None


class TestScoredDecisionTrace:
    def test_basic(self, sample_trace):
        scored = ScoredDecisionTrace(trace=sample_trace, similarity=0.92)
        assert scored.similarity == 0.92
        assert scored.trace.intent.description == "Fix the login bug"


class TestGraphEntity:
    def test_basic(self):
        e = GraphEntity(label="CodeFile", properties={"path": "/src/main.py"}, created_at="now")
        assert e.label == "CodeFile"
        assert e.created_by is None

    def test_with_creator(self):
        e = GraphEntity(label="CodeFile", properties={}, created_at="now", created_by="agent-1")
        assert e.created_by == "agent-1"


class TestGraphRelationship:
    def test_basic(self):
        r = GraphRelationship(source_id="1", target_id="2", type="IMPORTS", created_at="now")
        assert r.properties is None
        assert r.created_by is None


class TestSchemaOverview:
    def test_basic(self, sample_schema):
        assert len(sample_schema.node_labels) == 2
        assert sample_schema.node_counts["CodeFile"] == 10


class TestFormattedContext:
    def test_empty(self):
        ctx = FormattedContext(past_traces=[], rules=[], anti_patterns=[], skills=[])
        assert ctx.schema is None

    def test_with_schema(self, sample_schema):
        ctx = FormattedContext(past_traces=[], rules=[], anti_patterns=[], skills=[], schema=sample_schema)
        assert ctx.schema.node_labels == ["CodeFile", "APIEndpoint"]


class TestSkill:
    def test_basic(self, sample_skill):
        assert sample_skill.name == "handle-auth-issues"
        assert sample_skill.confidence == 0.85
        assert len(sample_skill.tools) == 2


class TestStructuralNodes:
    def test_agent_node(self):
        a = AgentNode(name="bot", created_at="now")
        assert a.description is None

    def test_domain(self):
        d = Domain(name="tech", created_at="now")
        assert d.id is None

    def test_project(self):
        p = Project(name="myproj", tenant="acme", created_at="now")
        assert p.tenant == "acme"

    def test_concept(self):
        c = Concept(name="auth", created_at="now")
        assert c.embedding is None
