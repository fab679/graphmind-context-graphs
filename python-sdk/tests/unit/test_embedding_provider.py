"""Tests for embeddings/provider.py — protocol compliance."""

from graphmind_context_graphs.embeddings.provider import EmbeddingProvider


class TestEmbeddingProviderProtocol:
    def test_fake_has_required_methods(self, fake_embedding):
        """Verify our FakeEmbeddingProvider has all Protocol methods."""
        assert hasattr(fake_embedding, "dimensions")
        assert hasattr(fake_embedding, "embed")
        assert hasattr(fake_embedding, "embed_batch")
        assert fake_embedding.dimensions == 4
        assert len(fake_embedding.embed("test")) == 4
        assert len(fake_embedding.embed_batch(["a", "b"])) == 2

    def test_protocol_defines_expected_interface(self):
        """Verify the Protocol has the expected method signatures."""
        assert hasattr(EmbeddingProvider, "embed")
        assert hasattr(EmbeddingProvider, "embed_batch")
        assert hasattr(EmbeddingProvider, "dimensions")
