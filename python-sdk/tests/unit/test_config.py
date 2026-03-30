"""Tests for types/config.py."""

from graphmind_context_graphs.types.config import (
    GraphmindConnectionConfig, EmbeddingConfig, ContextGraphConfig,
    ResolvedContextGraphConfig, DEFAULT_VECTOR_SEARCH_LIMIT,
    DEFAULT_SIMILARITY_THRESHOLD, DEFAULT_METRIC,
)


class TestGraphmindConnectionConfig:
    def test_defaults(self):
        c = GraphmindConnectionConfig()
        assert c.url is None
        assert c.token is None
        assert c.username is None
        assert c.password is None

    def test_custom(self):
        c = GraphmindConnectionConfig(url="http://db:8080", token="abc")
        assert c.url == "http://db:8080"
        assert c.token == "abc"


class TestEmbeddingConfig:
    def test_defaults(self, fake_embedding):
        c = EmbeddingConfig(provider=fake_embedding, dimensions=4)
        assert c.metric == "cosine"

    def test_custom_metric(self, fake_embedding):
        c = EmbeddingConfig(provider=fake_embedding, dimensions=4, metric="l2")
        assert c.metric == "l2"


class TestContextGraphConfig:
    def test_defaults(self, fake_embedding):
        c = ContextGraphConfig(
            tenant="acme", project="proj",
            embedding=EmbeddingConfig(provider=fake_embedding, dimensions=4),
        )
        assert c.context_sharing == "shared"
        assert c.vector_search_limit == DEFAULT_VECTOR_SEARCH_LIMIT
        assert c.similarity_threshold == DEFAULT_SIMILARITY_THRESHOLD
        assert c.allowed_agents == []
        assert c.observer_model is None
        assert c.debug is False
        assert c.base_system_prompt is None

    def test_custom(self, fake_embedding):
        c = ContextGraphConfig(
            tenant="acme", project="proj",
            embedding=EmbeddingConfig(provider=fake_embedding, dimensions=4),
            domain="tech", agent="bot", context_sharing="isolated",
            vector_search_limit=10, debug=True,
        )
        assert c.domain == "tech"
        assert c.context_sharing == "isolated"
        assert c.vector_search_limit == 10


class TestResolvedContextGraphConfig:
    def test_inherits_context_graph_config(self, fake_embedding):
        r = ResolvedContextGraphConfig(
            tenant="acme", project="proj",
            embedding=EmbeddingConfig(provider=fake_embedding, dimensions=4),
        )
        assert isinstance(r, ContextGraphConfig)


class TestConstants:
    def test_defaults(self):
        assert DEFAULT_VECTOR_SEARCH_LIMIT == 5
        assert DEFAULT_SIMILARITY_THRESHOLD == 0.7
        assert DEFAULT_METRIC == "cosine"
