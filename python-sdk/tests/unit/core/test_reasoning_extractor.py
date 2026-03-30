"""Tests for core/reasoning_extractor.py — extraction helpers."""

from unittest.mock import MagicMock

from graphmind_context_graphs.core.reasoning_extractor import (
    _extract_facts, _extract_tool_calls, _classify_fact,
    _extract_concepts_fallback, _infer_domain_fallback,
)


def _make_msg(role: str, content: str, tool_calls=None, tool_call_id=None):
    msg = MagicMock()
    msg.type = role
    msg.role = role
    msg.content = content
    msg.tool_calls = tool_calls or []
    msg.tool_call_id = tool_call_id
    return msg


class TestExtractFacts:
    def test_extracts_from_ai_messages(self):
        messages = [
            _make_msg("human", "What happened?"),
            _make_msg("ai", "The server crashed due to a memory leak. We need to investigate the heap allocation."),
        ]
        facts = _extract_facts(messages)
        assert len(facts) > 0
        assert all(len(f) > 20 for f in facts)

    def test_skips_tool_call_messages(self):
        messages = [
            _make_msg("ai", "Let me search for that.", tool_calls=[{"name": "search", "args": {}}]),
        ]
        facts = _extract_facts(messages)
        assert facts == []

    def test_skips_human_messages(self):
        messages = [_make_msg("human", "This is a very long user message that should not be extracted as a fact.")]
        facts = _extract_facts(messages)
        assert facts == []

    def test_limits_to_5(self):
        # Create AI message with many sentences
        long_text = ". ".join(f"Sentence number {i} with enough length" for i in range(20))
        messages = [_make_msg("ai", long_text)]
        facts = _extract_facts(messages)
        assert len(facts) <= 5

    def test_filters_short_sentences(self):
        messages = [_make_msg("ai", "OK. Sure. This is a longer sentence that should be kept.")]
        facts = _extract_facts(messages)
        for f in facts:
            assert len(f) > 20


class TestExtractToolCalls:
    def test_basic(self):
        messages = [
            _make_msg("ai", "", tool_calls=[{"name": "search", "args": {"q": "auth"}, "id": "tc1"}]),
            _make_msg("tool", "Found 3 results", tool_call_id="tc1"),
        ]
        records = _extract_tool_calls(messages)
        assert len(records) == 1
        assert records[0].name == "search"
        assert records[0].result == "Found 3 results"

    def test_no_tool_calls(self):
        messages = [_make_msg("human", "hello"), _make_msg("ai", "hi")]
        records = _extract_tool_calls(messages)
        assert records == []

    def test_truncates_long_results(self):
        messages = [
            _make_msg("ai", "", tool_calls=[{"name": "read", "args": {}, "id": "tc1"}]),
            _make_msg("tool", "x" * 1000, tool_call_id="tc1"),
        ]
        records = _extract_tool_calls(messages)
        assert len(records[0].result) <= 500


class TestClassifyFact:
    def test_blocker(self):
        assert _classify_fact("The request failed with a timeout") == "blocker"
        assert _classify_fact("Access was denied") == "blocker"
        assert _classify_fact("Cannot connect to database") == "blocker"

    def test_permission(self):
        assert _classify_fact("User was granted access to the resource") == "permission"
        assert _classify_fact("Auth token allows read operations") == "permission"

    def test_pivot(self):
        assert _classify_fact("We decided to use a different approach") == "pivot"


class TestExtractConceptsFallback:
    def test_billing(self):
        concepts = _extract_concepts_fallback("billing issue", "processed refund", [])
        assert "billing" in concepts

    def test_rate_limiting(self):
        concepts = _extract_concepts_fallback("getting 429 errors", "added rate limit", [])
        assert "rate-limiting" in concepts

    def test_deployment(self):
        concepts = _extract_concepts_fallback("deploy the service", "release complete", [])
        assert "deployment" in concepts

    def test_multiple_concepts(self):
        concepts = _extract_concepts_fallback(
            "password reset failed with timeout",
            "fixed the auth flow and reset mechanism", [],
        )
        assert "password-reset" in concepts
        assert "performance" in concepts

    def test_no_match(self):
        concepts = _extract_concepts_fallback("hello world", "printed greeting", [])
        assert concepts == []


class TestInferDomainFallback:
    def test_tech(self):
        assert _infer_domain_fallback("api endpoint failing", "fixed SDK") == "tech"

    def test_finance(self):
        assert _infer_domain_fallback("billing issue", "processed payment") == "finance"

    def test_support(self):
        assert _infer_domain_fallback("account locked", "reset password") == "support"

    def test_legal(self):
        assert _infer_domain_fallback("compliance issue", "updated contract") == "legal"

    def test_medical(self):
        assert _infer_domain_fallback("patient diagnosis", "treatment plan") == "medical"

    def test_general(self):
        assert _infer_domain_fallback("random stuff", "did something") == "general"
