# Multi-Agent Systems — Python SDK

Multiple agents share a project graph with configurable visibility. All agents with the same `tenant` write to the same Graphmind graph namespace (`cg_{tenant}`). Agents in the same `project` share decision traces based on their `context_sharing` policy.

## Setup

```python
from graphmind_context_graphs import create_context_graph, ContextGraphConfig, EmbeddingConfig

embedding_config = EmbeddingConfig(provider=my_embeddings, dimensions=1536)

# Legal agent — selective: sees own traces + compliance agent's traces
legal_cg = create_context_graph(ContextGraphConfig(
    tenant="acme", project="ops",
    agent="legal-agent", domain="legal",
    context_sharing="selective",
    allowed_agents=["compliance-agent"],
    embedding=embedding_config,
))

# Tech agent — shared: sees all traces in the project
tech_cg = create_context_graph(ContextGraphConfig(
    tenant="acme", project="ops",
    agent="tech-agent", domain="tech",
    context_sharing="shared",
    embedding=embedding_config,
))

# Medical agent — isolated: sees only its own traces
medical_cg = create_context_graph(ContextGraphConfig(
    tenant="acme", project="ops",
    agent="medical-agent", domain="medical",
    context_sharing="isolated",
    embedding=embedding_config,
))
```

Each returns its own middleware and tools — create separate agents:

```python
from langchain.agents import create_agent

legal_agent = create_agent(
    "openai:gpt-4.1",
    tools=[*legal_tools, *legal_cg.tools],
    middleware=legal_cg.middleware,
)

tech_agent = create_agent(
    "openai:gpt-4.1",
    tools=[*tech_tools, *tech_cg.tools],
    middleware=tech_cg.middleware,
)
```

## Sharing Policies

| Policy | Vector Search (past traces) | Rules & Anti-patterns | Brain Map (entities) |
|---|---|---|---|
| `shared` | All agents' traces | All in project | Own only |
| `isolated` | Own traces only | Own only | Own only |
| `selective` | Own + `allowed_agents` | Own + `allowed_agents` | Own only |

### How It Works

- **Vector search**: The `context_sharing` policy controls which agents' traces are included in similarity search results. `isolated` filters to `WHERE ag.name = $agentName`, `selective` filters to `WHERE ag.name IN [self + allowed_agents]`, `shared` has no agent filter.
- **Rules/anti-patterns**: Same agent filtering applies to `get_active_rules()` and `get_anti_patterns()`.
- **Brain map (entities)**: Schema introspection is always agent-scoped when `agent` is configured. The legal agent sees `Contract`, `Regulation` — not the tech agent's `CodeFile`, `Dependency`.

## Cross-SDK Sharing

Both the Python and TypeScript SDKs share the same Graphmind database and graph schema. A Python agent and a TypeScript agent can share context as long as they use the same `tenant` and `project`:

```python
# Python agent writes to cg_acme graph, project "ops"
python_cg = create_context_graph(ContextGraphConfig(
    tenant="acme", project="ops", agent="python-bot",
    context_sharing="shared",
    embedding=EmbeddingConfig(provider=my_embeddings, dimensions=1536),
))
```

```typescript
// TypeScript agent reads from same cg_acme graph, project "ops"
const tsCG = await createContextGraph({
  tenant: "acme", project: "ops", agent: "ts-bot",
  contextSharing: "shared",
  embedding: { provider: myEmbeddings, dimensions: 1536 },
});
```

Both see each other's traces (if sharing policy allows). The graph namespace is deterministic: `cg_{sanitized_tenant}`.

## Monitoring Agents

```python
# List all agents in the project
agents = cg.store.get_agents_by_project()
for a in agents:
    print(f"  {a['name']}: {a['description']}")

# Each agent's traces are linked via PRODUCED_BY relationships
# and can be queried with the graph query tool:
# MATCH (t:DecisionTrace)-[:PRODUCED_BY]->(ag:Agent {name: "legal-agent"})
# RETURN t, ag
```
