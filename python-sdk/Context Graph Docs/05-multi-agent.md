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

## Runtime Tenant Creation (v0.3.0)

> **NEW** — Dynamically create new tenants from runtime context without code changes.

While the examples above show multiple agents sharing a project within a single tenant, you can also create new tenants on-demand via runtime context. This is perfect for multi-tenant SaaS applications where each customer needs complete data isolation.

### How It Works

When you pass a different tenant in the runtime context, the system automatically:

1. Creates a new isolated graph namespace for that tenant (e.g., `cg_customer123`)
2. Bootstraps the schema for the new tenant's graph
3. Routes all queries and writes to the correct tenant's graph

### Example: SaaS Multi-Tenancy

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
            "tenant": customer_id,        # Creates new graph if needed
            "project": "main",
            "agent": "support-agent",
        }}
    )

# Customer A - gets their own isolated graph
await handle_customer_request("customer-a", "I need help with billing")

# Customer B - gets a separate isolated graph
await handle_customer_request("customer-b", "How do I reset my password?")
```

### Data Isolation

Each tenant gets complete isolation:

| Resource | Isolation |
|----------|-----------|
| Graph namespace | Separate (`cg_customer-a`, `cg_customer-b`) |
| Decision traces | Isolated per tenant |
| Entities/Schema | Isolated per tenant |
| Vector embeddings | Isolated per tenant |

The runtime tenant context supports:
- `tenant`: Target tenant identifier
- `project`: Project scope within the tenant
- `agent`: Agent name for this request
- `agent_description`: Human-readable agent role
- `embedding`: Override embedding provider for this request

This works seamlessly with the Python SDK's multi-agent features — each tenant can have their own set of agents with isolated or shared context policies.
