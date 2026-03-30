"""Shared fixtures for Python SDK tests."""

from __future__ import annotations

from dataclasses import dataclass
from unittest.mock import MagicMock

import pytest

from graphmind_context_graphs.types.config import (
    ContextGraphConfig, ResolvedContextGraphConfig, GraphmindConnectionConfig, EmbeddingConfig,
)
from graphmind_context_graphs.types.data_model import (
    DecisionTrace, Intent, Action, Constraint, Justification, ToolCallRecord,
    ScoredDecisionTrace, Skill, SchemaOverview, FormattedContext, GraphEntity, GraphRelationship,
)
from graphmind_context_graphs.types.lifecycle import ValidationResult, LifecycleStats


class FakeEmbeddingProvider:
    """Deterministic embedding provider for tests."""

    @property
    def dimensions(self) -> int:
        return 4

    def embed(self, text: str) -> list[float]:
        return [0.1, 0.2, 0.3, 0.4]

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return [[0.1, 0.2, 0.3, 0.4]] * len(texts)


@pytest.fixture
def fake_embedding():
    return FakeEmbeddingProvider()


@pytest.fixture
def mock_client():
    """Mock GraphmindClient."""
    client = MagicMock()
    client.connect.return_value = client

    # Default empty result
    empty_result = MagicMock()
    empty_result.records = []
    empty_result.columns = []

    client.query.return_value = empty_result
    client.query_readonly.return_value = empty_result
    return client


@pytest.fixture
def resolved_config(fake_embedding):
    return ResolvedContextGraphConfig(
        tenant="test_tenant",
        project="test_project",
        embedding=EmbeddingConfig(provider=fake_embedding, dimensions=4),
        graphmind=GraphmindConnectionConfig(url="http://localhost:8080"),
        domain="tech",
        agent="test-agent",
        agent_description="A test agent",
        context_sharing="shared",
        debug=False,
    )


@pytest.fixture
def sample_trace():
    return DecisionTrace(
        intent=Intent(description="Fix the login bug", created_at="2026-01-01T00:00:00Z"),
        constraints=[
            Constraint(description="Must not break SSO", type="blocker", created_at="2026-01-01T00:00:00Z"),
        ],
        action=Action(description="Patched auth middleware", outcome="success", created_at="2026-01-01T00:00:00Z"),
        justification=Justification(description="SSO flow was bypassing token refresh", confidence=0.7),
        project="test_project",
        tenant="test_tenant",
        status="captured",
        domain="tech",
        agent="test-agent",
        concepts=["authentication", "sso"],
        tool_calls=[ToolCallRecord(name="search_code", args='{"query": "auth"}', created_at="2026-01-01T00:00:00Z")],
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )


@pytest.fixture
def sample_skill():
    return Skill(
        name="handle-auth-issues",
        description="Diagnose and fix authentication problems",
        prompt="When handling auth issues, check token expiry first...",
        confidence=0.85,
        concepts=["authentication", "tokens"],
        tools=["search_code", "check_logs"],
        trace_count=5,
        domain="tech",
        created_at="2026-01-01T00:00:00Z",
        updated_at="2026-01-01T00:00:00Z",
    )


@pytest.fixture
def sample_schema():
    return SchemaOverview(
        node_labels=["CodeFile", "APIEndpoint"],
        relationship_types=["IMPORTS", "CALLS"],
        node_counts={"CodeFile": 10, "APIEndpoint": 3},
        edge_counts={"IMPORTS": 15, "CALLS": 7},
    )
