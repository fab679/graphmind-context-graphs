"""Tests for core/prompt_injector.py — formatting functions."""

from graphmind_context_graphs.core.prompt_injector import (
    _truncate, _format_past_logic, _format_rules, _format_anti_patterns, _format_skill_manifest,
)
from graphmind_context_graphs.types.data_model import (
    DecisionTrace, Intent, Action, Constraint, Justification,
    ScoredDecisionTrace, Skill,
)


def _make_trace(desc: str = "test", confidence: float = 0.8, domain: str | None = None,
                concepts: list[str] | None = None, constraints: list[Constraint] | None = None) -> DecisionTrace:
    return DecisionTrace(
        intent=Intent(description=f"Intent: {desc}", created_at="now"),
        constraints=constraints or [],
        action=Action(description=f"Action: {desc}", created_at="now"),
        justification=Justification(description=f"Because: {desc}", confidence=confidence),
        project="p", tenant="t", status="synthesized",
        domain=domain, concepts=concepts,
        created_at="now", updated_at="now",
    )


class TestTruncate:
    def test_short(self):
        assert _truncate("hello", 100) == "hello"

    def test_empty(self):
        assert _truncate("", 100) == ""

    def test_long(self):
        result = _truncate("a" * 200, 50)
        assert len(result) == 50
        assert result.endswith("\u2026")

    def test_collapses_whitespace(self):
        assert _truncate("  hello   world  ", 100) == "hello world"


class TestFormatPastLogic:
    def test_basic(self):
        scored = ScoredDecisionTrace(trace=_make_trace("login fix"), similarity=0.88)
        result = _format_past_logic([scored])
        assert "Relevant Past Logic" in result
        assert "0.88" in result
        assert "Intent:" in result

    def test_with_domain(self):
        scored = ScoredDecisionTrace(trace=_make_trace("test", domain="tech"), similarity=0.7)
        result = _format_past_logic([scored])
        assert "[tech]" in result

    def test_with_concepts(self):
        scored = ScoredDecisionTrace(trace=_make_trace("test", concepts=["auth", "sso"]), similarity=0.7)
        result = _format_past_logic([scored])
        assert "#auth" in result
        assert "#sso" in result

    def test_with_constraints(self):
        constraints = [Constraint(description="Must not break SSO", type="blocker", created_at="now")]
        scored = ScoredDecisionTrace(trace=_make_trace("test", constraints=constraints), similarity=0.7)
        result = _format_past_logic([scored])
        assert "[blocker]" in result
        assert "Must not break SSO" in result

    def test_multiple_traces(self):
        traces = [
            ScoredDecisionTrace(trace=_make_trace("first"), similarity=0.9),
            ScoredDecisionTrace(trace=_make_trace("second"), similarity=0.8),
        ]
        result = _format_past_logic(traces)
        assert "first" in result
        assert "second" in result


class TestFormatRules:
    def test_basic(self):
        rules = [_make_trace("always check tokens", confidence=0.9)]
        result = _format_rules(rules)
        assert "Established Rules" in result
        assert "0.90" in result
        assert "always check tokens" in result

    def test_with_concepts(self):
        rules = [_make_trace("test", concepts=["auth"])]
        result = _format_rules(rules)
        assert "#auth" in result


class TestFormatAntiPatterns:
    def test_basic(self):
        patterns = [_make_trace("bad approach")]
        result = _format_anti_patterns(patterns)
        assert "Anti-Patterns" in result
        assert "AVOID" in result
        assert "bad approach" in result


class TestFormatSkillManifest:
    def test_basic(self):
        skills = [Skill(
            name="auth-diagnosis", description="Diagnose auth issues",
            prompt="...", confidence=0.85, concepts=[], tools=[],
            trace_count=3, created_at="now", updated_at="now",
        )]
        result = _format_skill_manifest(skills)
        assert "Skills System" in result
        assert "auth-diagnosis" in result

    def test_with_domain_and_tools(self):
        skills = [Skill(
            name="test-skill", description="desc",
            prompt="...", confidence=0.9, concepts=[], tools=["search", "deploy"],
            trace_count=5, domain="tech", created_at="now", updated_at="now",
        )]
        result = _format_skill_manifest(skills)
        assert "[tech]" in result
        assert "search, deploy" in result
