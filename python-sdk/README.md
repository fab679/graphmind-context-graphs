# Graphmind Context Graphs — Python SDK

A "Director's Commentary" middleware for LangChain Python agents. Captures **why** agents make decisions, not just what they did.

## Installation

```bash
pip install graphmind-context-graphs
```

### Prerequisites

```bash
# Graphmind database
docker run -d --name graphmind -p 8080:8080 fabischk/graphmind:latest

# LangChain + provider
pip install langchain langchain-core langgraph langchain-openai
```

## Quick Start

```python
from langchain.agents import create_agent
from graphmind_context_graphs import (
    create_context_graph,
    ContextGraphConfig,
    EmbeddingConfig,
)

# Your embedding provider (must implement embed, embed_batch, dimensions)
embedding_provider = MyEmbeddingProvider()

# Initialize
cg = create_context_graph(ContextGraphConfig(
    tenant="my_company",
    project="support",
    agent="support-agent",
    embedding=EmbeddingConfig(provider=embedding_provider, dimensions=1536),
    observer_model="openai:gpt-4.1-mini",  # Optional: for LLM-powered extraction
))

# Create agent with middleware + brain-mapping tools
agent = create_agent(
    "openai:gpt-4.1",
    tools=[*my_tools, *cg.tools],
    middleware=cg.middleware,
)

# Use — context captured and injected automatically
result = agent.invoke({"messages": [{"role": "user", "content": "My account is locked"}]})

# Evolve knowledge
cg.lifecycle.validate_trace(trace_id, ValidationResult(trace_id=trace_id, success=True))
cg.lifecycle.synthesize_rules()
```

## Features

- **Decision Trace Capture** — Intent/Constraint/Action/Justification triplets
- **Dynamic Brain Mapping** — Agents create entities (CodeFile, Contract, etc.) and relationships
- **Schema Awareness** — Agent-scoped; only domain entities shown
- **LLM-Powered Extraction** — Observer model extracts domain, concepts, constraints
- **Knowledge Lifecycle** — Capture → Validate → Synthesize → Prune
- **Multi-Agent** — Shared, isolated, or selective context sharing
- **Vector Search** — Semantic similarity via Graphmind SEARCH clause

## API Mirror

This SDK mirrors the TypeScript SDK. Both use the same Graphmind database and Cypher queries. Agents running in different languages can share context graphs.

| TypeScript | Python |
|---|---|
| `createContextGraph()` | `create_context_graph()` |
| `cg.middleware` | `cg.middleware` |
| `cg.tools` | `cg.tools` |
| `cg.lifecycle.validateTrace()` | `cg.lifecycle.validate_trace()` |
| `cg.store.getSchemaOverview()` | `cg.store.get_schema_overview()` |

## License

Apache License 2.0
