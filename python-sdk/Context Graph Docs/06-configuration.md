# Configuration — Python SDK

## ContextGraphConfig

All configuration is passed via `ContextGraphConfig`. Connection details can come from explicit values or environment variables (loaded from `.env` automatically).

```python
from graphmind_context_graphs import (
    create_context_graph, ContextGraphConfig, EmbeddingConfig, GraphmindConnectionConfig,
)

config = ContextGraphConfig(
    # ── Required ──────────────────────────────────────────────────────────
    tenant="my_company",                    # Maps to graph namespace cg_my_company
    project="support",                      # Project scope within tenant
    embedding=EmbeddingConfig(
        provider=my_embedding_provider,     # Must implement EmbeddingProvider protocol
        dimensions=1536,                    # Vector dimensions
        metric="cosine",                    # "cosine" | "l2" | "dot" (default: cosine)
    ),

    # ── Optional — Graphmind connection ───────────────────────────────────
    graphmind=GraphmindConnectionConfig(
        url="http://localhost:8080",        # Default; env: GRAPHMIND_URL
        token="bearer-token",              # env: GRAPHMIND_TOKEN
        username="admin",                  # env: GRAPHMIND_USERNAME
        password="secret",                 # env: GRAPHMIND_PASSWORD
    ),

    # ── Optional — Agent identity ─────────────────────────────────────────
    agent="support-agent",                  # Agent name for multi-agent
    agent_description="Handles support",    # Human-readable description
    domain="support",                       # Explicit domain (or auto-inferred by heuristics)

    # ── Optional — Context sharing ────────────────────────────────────────
    context_sharing="shared",               # "shared" | "isolated" | "selective"
    allowed_agents=["admin-agent"],         # For selective sharing

    # ── Optional — Intelligence ───────────────────────────────────────────
    observer_model="openai:gpt-4.1-mini",  # Enables LLM-powered extraction
    vector_search_limit=5,                  # Top-k vector results (default: 5)
    similarity_threshold=0.7,              # Precedent linking threshold (default: 0.7)

    # ── Optional — Prompt ─────────────────────────────────────────────────
    base_system_prompt="You are a helpful agent.",  # Prepended to injected context
    debug=False,                           # Enable debug logging
)

cg = create_context_graph(config)
```

## Environment Variables

All connection config can come from environment variables (loaded from `.env` via `python-dotenv`):

| Variable | Description | Default |
|---|---|---|
| `GRAPHMIND_URL` | Graphmind server URL | `http://localhost:8080` |
| `GRAPHMIND_TOKEN` | Bearer auth token | — |
| `GRAPHMIND_USERNAME` | Basic auth username | — |
| `GRAPHMIND_PASSWORD` | Basic auth password | — |
| `OPENAI_API_KEY` | Required for OpenAI embeddings/models | — |

Explicit values in `GraphmindConnectionConfig` take precedence over environment variables.

## EmbeddingProvider Protocol

Any object that implements these three members works as an embedding provider:

```python
from typing import Protocol

class EmbeddingProvider(Protocol):
    @property
    def dimensions(self) -> int: ...
    def embed(self, text: str) -> list[float]: ...
    def embed_batch(self, texts: list[str]) -> list[list[float]]: ...
```

The protocol is not `@runtime_checkable` — it uses structural subtyping (duck typing). Any class with matching methods works without inheriting from `EmbeddingProvider`.

### OpenAI Example

```python
from langchain_openai import OpenAIEmbeddings

class OpenAIEmbeddingProvider:
    def __init__(self, model: str = "text-embedding-3-small", dims: int = 1536):
        self._embeddings = OpenAIEmbeddings(model=model)
        self._dimensions = dims

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def embed(self, text: str) -> list[float]:
        return self._embeddings.embed_query(text)

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return self._embeddings.embed_documents(texts)
```

### Custom Example (e.g., local model)

```python
import numpy as np
from sentence_transformers import SentenceTransformer

class LocalEmbeddingProvider:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2"):
        self._model = SentenceTransformer(model_name)
        self._dimensions = self._model.get_sentence_embedding_dimension()

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def embed(self, text: str) -> list[float]:
        return self._model.encode(text).tolist()

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return self._model.encode(texts).tolist()
```

## ContextGraphInstance

`create_context_graph()` returns a `ContextGraphInstance` dataclass:

```python
@dataclass
class ContextGraphInstance:
    middleware: list          # [prompt_injector, reasoning_extractor]
    tools: list              # [inspect_schema, query_graph, create_entity, create_relationship, find_entities]
    registry: ContextualRegistry     # Semantic retrieval & decision recording
    lifecycle: KnowledgeLifecycleManager  # Validate, synthesize, prune
    store: GraphmindStore    # Direct database access
```

### Usage

```python
cg = create_context_graph(config)

# Pass to create_agent
agent = create_agent("openai:gpt-4.1", tools=[*my_tools, *cg.tools], middleware=cg.middleware)

# Use lifecycle for knowledge evolution
stats = cg.lifecycle.get_lifecycle_stats()

# Use store for direct queries
trace = cg.store.get_trace_by_id("42")
concepts = cg.store.get_concepts_by_project()
```

## Defaults

| Setting | Default |
|---|---|
| `vector_search_limit` | 5 |
| `similarity_threshold` | 0.7 |
| `metric` | `"cosine"` |
| `context_sharing` | `"shared"` |
| `debug` | `False` |
| `graphmind.url` | `http://localhost:8080` |
