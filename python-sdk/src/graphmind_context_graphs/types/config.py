from __future__ import annotations
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from ..embeddings.provider import EmbeddingProvider

DEFAULT_VECTOR_SEARCH_LIMIT = 5
DEFAULT_SIMILARITY_THRESHOLD = 0.7
DEFAULT_METRIC: Literal["cosine", "l2", "dot"] = "cosine"


@dataclass
class GraphmindConnectionConfig:
    url: str | None = None
    token: str | None = None
    username: str | None = None
    password: str | None = None


@dataclass
class EmbeddingConfig:
    provider: EmbeddingProvider
    dimensions: int
    metric: Literal["cosine", "l2", "dot"] = "cosine"


@dataclass
class ContextGraphConfig:
    tenant: str
    project: str
    embedding: EmbeddingConfig
    graphmind: GraphmindConnectionConfig | None = None
    domain: str | None = None
    agent: str | None = None
    agent_description: str | None = None
    context_sharing: Literal["shared", "isolated", "selective"] = "shared"
    allowed_agents: list[str] = field(default_factory=list)
    observer_model: str | None = None
    vector_search_limit: int = DEFAULT_VECTOR_SEARCH_LIMIT
    similarity_threshold: float = DEFAULT_SIMILARITY_THRESHOLD
    base_system_prompt: str | None = None
    debug: bool = False


@dataclass
class ResolvedContextGraphConfig(ContextGraphConfig):
    """Config with graphmind connection resolved from env vars."""
    pass
