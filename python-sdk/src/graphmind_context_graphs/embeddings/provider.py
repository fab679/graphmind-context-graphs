from typing import Protocol


class EmbeddingProvider(Protocol):
    """Interface for embedding providers. Any class with matching methods works."""

    @property
    def dimensions(self) -> int: ...

    def embed(self, text: str) -> list[float]: ...

    def embed_batch(self, texts: list[str]) -> list[list[float]]: ...
