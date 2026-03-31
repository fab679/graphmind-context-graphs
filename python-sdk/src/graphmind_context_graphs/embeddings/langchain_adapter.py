"""
LangChain Embeddings Adapter — Auto-detect dimensions from any LangChain embedding model.

Wraps any LangChain Embeddings class (OpenAI, Azure, Cohere, Ollama, etc.)
and automatically detects embedding dimensions by making a test embedding call.

Supports all LangChain embedding providers:
- OpenAI (langchain-openai)
- Azure OpenAI (langchain-openai)
- AWS Bedrock (langchain-aws)
- Google Gemini (langchain-google-genai)
- Google Vertex AI (langchain-google-vertexai)
- MistralAI (langchain-mistralai)
- Cohere (langchain-cohere)
- Ollama (langchain-ollama)
- And all other LangChain-compatible embeddings
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from .provider import EmbeddingProvider

if TYPE_CHECKING:
    from typing import List


class LangChainEmbeddings(Protocol):
    """Protocol matching LangChain's Embeddings class interface."""

    def embed_query(self, text: str) -> List[float]:
        """Embed a single text string."""
        ...

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        """Embed multiple texts in batch."""
        ...


class LangChainEmbeddingAdapter(EmbeddingProvider):
    """
    Adapter that wraps any LangChain Embeddings and provides auto-detected dimensions.

    Automatically detects embedding dimensions by making a test embedding call
    on first use. This works with any LangChain-compatible embedding model.

    Example:
        ```python
        from langchain_openai import OpenAIEmbeddings
        from graphmind_context_graphs import LangChainEmbeddingAdapter

        langchain_embeddings = OpenAIEmbeddings(
            model="text-embedding-3-large"
        )

        provider = LangChainEmbeddingAdapter(langchain_embeddings)

        # Dimensions auto-detected on first embed() call
        cg = create_context_graph(ContextGraphConfig(
            tenant="my_tenant",
            project="my_project",
            embedding=EmbeddingConfig(provider=provider, dimensions=provider.dimensions),
        ))
        ```
    """

    def __init__(self, embeddings: LangChainEmbeddings) -> None:
        self._embeddings = embeddings
        self._dimensions: int | None = None

    @property
    def dimensions(self) -> int:
        """Get embedding dimensions. Auto-detects on first call by making a test embedding."""
        if self._dimensions is None:
            raise RuntimeError(
                "Dimensions not yet detected. Call embed() or embed_batch() first, "
                "or use await provider.detect_dimensions() to pre-detect."
            )
        return self._dimensions

    async def detect_dimensions(self) -> int:
        """
        Explicitly detect dimensions by making a test embedding call.
        Call this before creating the ContextGraph if you need dimensions upfront.
        """
        if self._dimensions is not None:
            return self._dimensions

        # Use sync method for detection
        test_embedding = self._embeddings.embed_query("test")
        self._dimensions = len(test_embedding)
        return self._dimensions

    def embed(self, text: str) -> List[float]:
        """
        Embed a single text string.
        Auto-detects dimensions on first call.
        """
        result = self._embeddings.embed_query(text)

        # Auto-detect dimensions on first successful embedding
        if self._dimensions is None:
            self._dimensions = len(result)

        return result

    def embed_batch(self, texts: List[str]) -> List[List[float]]:
        """
        Embed multiple texts in batch.
        Auto-detects dimensions on first call.
        """
        if not texts:
            return []

        results = self._embeddings.embed_documents(texts)

        # Auto-detect dimensions on first successful embedding
        if self._dimensions is None and results:
            self._dimensions = len(results[0])

        return results


#: Known embedding dimensions for popular models.
#: Used as fallback when auto-detection isn't possible.
KNOWN_EMBEDDING_DIMENSIONS: dict[str, int] = {
    # OpenAI
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,

    # Azure OpenAI (same as OpenAI)
    "text-embedding-ada-002-azure": 1536,

    # AWS Bedrock
    "amazon.titan-embed-text-v1": 1536,
    "amazon.titan-embed-text-v2": 1024,
    "amazon.titan-embed-image-v1": 1024,

    # Google
    "text-embedding-004": 768,
    "gemini-embedding-001": 768,
    "embedding-001": 768,

    # MistralAI
    "mistral-embed": 1024,

    # Cohere
    "embed-english-v3.0": 1024,
    "embed-english-light-v3.0": 384,
    "embed-multilingual-v3.0": 1024,
    "embed-multilingual-light-v3.0": 384,

    # Ollama common models
    "llama2": 4096,
    "llama3": 4096,
    "mistral": 4096,
    "nomic-embed-text": 768,
    "mxbai-embed-large": 1024,
    "all-minilm": 384,
}


def get_known_embedding_dimensions(model_name: str) -> int | None:
    """Get known dimensions for a model name, or None if unknown."""
    return KNOWN_EMBEDDING_DIMENSIONS.get(model_name)
