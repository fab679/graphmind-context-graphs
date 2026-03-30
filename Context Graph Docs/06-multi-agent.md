# Multi-Agent Systems

The Context Graph supports multi-agent systems where several agents share a project graph. Each agent gets its own `ContextGraphInstance` but they all write to the same underlying project graph, building a collective brain map over time.

## Agent Nodes

Each agent is a first-class `Agent` node in the graph, linked to:
- **Project** via `MEMBER_OF`
- **Domain** via `OPERATES_IN`
- **DecisionTrace** via `PRODUCED_BY` (reverse: trace points back to its agent)

```
(Agent: legal-agent) --MEMBER_OF--> (Project: enterprise-ops)
                     --OPERATES_IN--> (Domain: legal)

(DecisionTrace) --PRODUCED_BY--> (Agent: legal-agent)
```

## Setting Up Agents

Specify the agent name when creating a context graph instance:

```typescript
import { createContextGraph } from "graphmind-context-graphs";

const legalAgent = await createContextGraph({
  tenant: "acme_corp",
  project: "enterprise-ops",
  domain: "legal",
  agent: "legal-agent",
  agentDescription: "Reviews contracts and checks compliance",
  contextSharing: "selective",
  allowedAgents: ["compliance-agent"],
  embedding: { provider, dimensions: 1536 },
});
```

The middleware automatically:
1. Creates or merges the Agent node
2. Links it to the Project via `MEMBER_OF` and Domain via `OPERATES_IN`
3. Tags all captured traces with `PRODUCED_BY` this agent

## Context Sharing Policies

Three policies control how agents see each other's traces during vector search:

### shared (default)

All agents see all traces in the project. Best for collaborative teams where agents benefit from each other's experience.

```typescript
const cg = await createContextGraph({
  // ...
  agent: "support-agent",
  contextSharing: "shared",
});
```

### isolated

Agents only see their own traces. Best for independent agents or privacy-sensitive domains where cross-contamination is a concern.

```typescript
const cg = await createContextGraph({
  // ...
  agent: "medical-agent",
  contextSharing: "isolated",
});
```

### selective

Agents see their own traces plus traces from explicitly allowed agents. Best for controlled cross-domain learning.

```typescript
const cg = await createContextGraph({
  // ...
  agent: "legal-agent",
  contextSharing: "selective",
  allowedAgents: ["compliance-agent", "hr-agent"],
});
```

The `allowedAgents` list is one-directional: the legal agent can read the compliance agent's traces, but the compliance agent cannot read the legal agent's traces unless it also lists `"legal-agent"` in its own `allowedAgents`.

## Cross-Pollination

When using `shared` or `selective` policies, agents learn from each other through two mechanisms:

**Shared concepts** -- Concept tags (e.g., `#compliance`, `#api-authentication`) link related traces across agents. When one agent's trace is tagged with a concept, other agents searching for that concept will find it.

**Vector similarity search** -- The embedding-based search finds semantically relevant traces regardless of which agent produced them. The sharing policy filters results after the search.

Examples:
- A Legal Agent learns "user prefers email over phone" from a Support Agent's trace
- A DevOps Agent inherits deployment rollback patterns from a previous DevOps Agent
- A Medical Agent picks up drug interaction warnings from another Medical Agent's validated traces

## Dynamic Entity Creation & Schema Isolation

Different agents in the same project contribute to the same underlying graph. When a coding agent creates `CodeFile` entities and a security agent creates `Vulnerability` entities, the graph grows organically:

```
(CodeFile: auth.ts) --CREATED_BY--> (Agent: coding-agent)
(Vulnerability: CVE-2024-1234) --CREATED_BY--> (Agent: security-agent)
(Vulnerability: CVE-2024-1234) --AFFECTS--> (CodeFile: auth.ts)
```

However, the **brain map (schema) is agent-scoped**:

| Layer | Sharing |
|---|---|
| Decision traces | Controlled by `contextSharing` policy |
| Rules & anti-patterns | Controlled by `contextSharing` policy |
| Brain map (entities/schema) | Always agent-scoped — each agent sees only its own |
| Skills | Project-scoped — available to all agents |

This means the coding agent's `inspect_schema` shows `CodeFile`, `Function`, `Dependency` — but not the security agent's `Vulnerability` or `ThreatModel`. Decision traces (the reasoning) flow across agents, but entity schemas stay private. This prevents confusion when agents from different domains create domain-specific entities.

See [09-schema-inspector.md](./09-schema-inspector.md) and [10-entity-builder.md](./10-entity-builder.md) for details.

## Querying Agent Data

```typescript
// List all agents in the project
const agents = await contextGraph.store.getAgentsByProject();
// [{ name: "legal-agent", description: "Reviews contracts..." }, ...]

// Tool usage stats for a specific agent
const stats = await contextGraph.store.getToolStatsByAgent("legal-agent");
// [{ toolName: "search_regulations", callCount: 12 }, ...]

// Project-wide tool statistics
const allStats = await contextGraph.store.getToolStats();
```

## Example: Multi-Agent Setup

```typescript
import { createContextGraph } from "graphmind-context-graphs";

// Each agent gets its own ContextGraphInstance
const legal = await createContextGraph({
  tenant: "acme_corp",
  project: "enterprise-ops",
  agent: "legal-agent",
  domain: "legal",
  contextSharing: "selective",
  allowedAgents: ["compliance-agent"],
  embedding: { provider, dimensions: 1536 },
});

const compliance = await createContextGraph({
  tenant: "acme_corp",
  project: "enterprise-ops",
  agent: "compliance-agent",
  domain: "legal",
  contextSharing: "selective",
  allowedAgents: ["legal-agent"],
  embedding: { provider, dimensions: 1536 },
});

const tech = await createContextGraph({
  tenant: "acme_corp",
  project: "enterprise-ops",
  agent: "tech-agent",
  domain: "tech",
  contextSharing: "shared",  // sees everything
  embedding: { provider, dimensions: 1536 },
});

// Each agent uses its own middleware and tools
const legalAgent = createAgent({
  model: "claude-sonnet-4-6",
  tools: [...legalTools, ...legal.tools],
  middleware: legal.middleware,
});
```

All three agents write to the same project graph (`enterprise-ops` under tenant `acme_corp`), but their visibility is controlled by their sharing policy.
