# Quickstart — Python SDK

## Installation

```bash
pip install graphmind-context-graphs
```

For OpenAI embeddings + models:
```bash
pip install langchain-openai
```

## Prerequisites

Graphmind running locally:
```bash
docker run -d --name graphmind -p 8080:8080 fabischk/graphmind:latest
```

## Minimal Example

```python
from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import OpenAIEmbeddings
from graphmind_context_graphs import (
    create_context_graph, ContextGraphConfig, EmbeddingConfig,
)


# 1. Embedding provider (any class with embed, embed_batch, dimensions)
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


# 2. Initialize context graph
cg = create_context_graph(ContextGraphConfig(
    tenant="my_company",
    project="support",
    agent="support-agent",
    embedding=EmbeddingConfig(provider=OpenAIEmbeddingProvider(), dimensions=1536),
))

# 3. Define tools
@tool
def search_kb(query: str) -> str:
    """Search knowledge base."""
    return f"Article about {query}"

# 4. Create agent with middleware + tools
agent = create_agent(
    "openai:gpt-4.1",
    tools=[search_kb, *cg.tools],
    middleware=cg.middleware,
)

# 5. Use — context captured and injected automatically
result = agent.invoke({
    "messages": [{"role": "user", "content": "How do I reset my password?"}]
})

# Print the agent's response
for msg in result["messages"]:
    role = getattr(msg, "type", "unknown")
    content = getattr(msg, "content", "")
    if role == "ai" and content:
        print(f"[Agent] {content}")
```

## What Happens

1. **First call**: The prompt injector queries the graph — finds nothing (discovery mode). Agent responds normally. The reasoning extractor captures the decision as a `DecisionTrace` with intent, action, constraints, justification, tool calls, and concepts.
2. **Second similar call**: The prompt injector finds the first trace via vector search and injects it as "Director's Commentary" in the system prompt — giving the agent memory of its past reasoning.
3. **Over time**: Traces are validated (confidence goes up or down), promoted to rules (synthesized), or pruned as anti-patterns.

## Full Working Example

See [`examples/basic_context_graph.py`](../examples/basic_context_graph.py) for a complete two-conversation demo with tool usage, context injection, and lifecycle stats.

## Environment Variables

Create a `.env` file:
```bash
GRAPHMIND_URL=http://localhost:8080
OPENAI_API_KEY=sk-...
```

The SDK loads `.env` automatically via `python-dotenv`.

## What Gets Created in the Graph

After one agent conversation, the graph contains:

| Node Type | Description |
|---|---|
| `Project` | Your project scope |
| `Agent` | The agent identity |
| `Domain` | Auto-detected or configured domain |
| `DecisionTrace` | The captured reasoning |
| `Intent` | What the user wanted |
| `Action` | What the agent did |
| `Constraint` | Reasoning constraints (blocker/permission/pivot) |
| `Concept` | Semantic tags extracted from the conversation |
| `Tool` | Tools used during the conversation |

Relationships link everything together: `HAS_INTENT`, `TOOK_ACTION`, `HAS_CONSTRAINT`, `BELONGS_TO_PROJECT`, `PRODUCED_BY`, `TAGGED_WITH`, `USED_TOOL`, `PRECEDENT_OF`, etc.

## Runtime Tenant Creation (v0.3.0)

> **NEW** — Dynamically create new tenants from runtime context without changing code.

The Python SDK supports multi-tenant SaaS use cases where each customer needs isolated context graphs. Pass a different tenant in the request context, and the system automatically creates a new isolated graph.

```python
from graphmind_context_graphs import create_context_graph, ContextGraphConfig, EmbeddingConfig

# Initialize once with a default/base tenant
cg = create_context_graph(ContextGraphConfig(
    tenant="default",
    project="saas-app",
    embedding=EmbeddingConfig(provider=my_embeddings, dimensions=1536),
))

# Create a single agent
agent = create_agent(
    "openai:gpt-4.1",
    tools=cg.tools,
    middleware=cg.middleware,
)

# Each customer request routes to their isolated tenant graph
async def handle_customer_request(customer_id: str, message: str):
    return await agent.invoke(
        {"messages": [{"role": "user", "content": message}]},
        {"context": {
            "tenant": customer_id,      # Creates new graph if needed
            "project": "main",
            "agent": "support-agent",
        }}
    )

# Customer A - gets their own isolated graph
await handle_customer_request("customer-a", "I need help with billing")

# Customer B - gets a separate isolated graph  
await handle_customer_request("customer-b", "How do I reset my password?")
```

Each tenant gets complete data isolation via separate graph namespaces (`cg_customer-a`, `cg_customer-b`).

The runtime context supports:
- `tenant`: Target tenant (creates new graph if different from base)
- `project`: Project scope within the tenant
- `agent`: Agent name for this request
- `agent_description`: Human-readable agent role
- `embedding`: Override embedding provider for this request
