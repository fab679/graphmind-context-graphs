"""Tests for __init__.py — _resolve_config and create_context_graph."""

from __future__ import annotations

import os
from unittest.mock import patch, MagicMock

from graphmind_context_graphs import _resolve_config, ContextGraphInstance
from graphmind_context_graphs.types.config import (
    ContextGraphConfig, GraphmindConnectionConfig, EmbeddingConfig,
)


class TestResolveConfig:
    def test_uses_explicit_values(self, fake_embedding):
        config = ContextGraphConfig(
            tenant="acme", project="proj",
            embedding=EmbeddingConfig(provider=fake_embedding, dimensions=4),
            graphmind=GraphmindConnectionConfig(url="http://mydb:8080", token="secret"),
        )
        resolved = _resolve_config(config)
        assert resolved.graphmind.url == "http://mydb:8080"
        assert resolved.graphmind.token == "secret"

    def test_falls_back_to_env(self, fake_embedding):
        config = ContextGraphConfig(
            tenant="acme", project="proj",
            embedding=EmbeddingConfig(provider=fake_embedding, dimensions=4),
        )
        with patch.dict(os.environ, {
            "GRAPHMIND_URL": "http://env-db:9090",
            "GRAPHMIND_TOKEN": "env-token",
        }):
            resolved = _resolve_config(config)
            assert resolved.graphmind.url == "http://env-db:9090"
            assert resolved.graphmind.token == "env-token"

    def test_default_url(self, fake_embedding):
        config = ContextGraphConfig(
            tenant="acme", project="proj",
            embedding=EmbeddingConfig(provider=fake_embedding, dimensions=4),
        )
        with patch.dict(os.environ, {}, clear=True):
            # Remove any existing env vars
            os.environ.pop("GRAPHMIND_URL", None)
            os.environ.pop("GRAPHMIND_TOKEN", None)
            resolved = _resolve_config(config)
            assert resolved.graphmind.url == "http://localhost:8080"

    def test_preserves_all_fields(self, fake_embedding):
        config = ContextGraphConfig(
            tenant="acme", project="proj",
            embedding=EmbeddingConfig(provider=fake_embedding, dimensions=4),
            domain="tech", agent="bot", agent_description="my bot",
            context_sharing="isolated", allowed_agents=["other"],
            vector_search_limit=10, similarity_threshold=0.8,
            base_system_prompt="You are helpful.", debug=True,
        )
        resolved = _resolve_config(config)
        assert resolved.tenant == "acme"
        assert resolved.domain == "tech"
        assert resolved.agent == "bot"
        assert resolved.context_sharing == "isolated"
        assert resolved.allowed_agents == ["other"]
        assert resolved.vector_search_limit == 10
        assert resolved.base_system_prompt == "You are helpful."
        assert resolved.debug is True
