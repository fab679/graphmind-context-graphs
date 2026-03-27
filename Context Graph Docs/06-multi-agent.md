# Multi-Agent Systems

The Context Graph supports multi-agent systems where multiple agents share a project and can be configured to share or isolate their decision traces.

## Agent Nodes

Each agent is represented as an `Agent` node in the graph, linked to:
- **Project** via `MEMBER_OF` — which project this agent belongs to
- **Domain** via `OPERATES_IN` — which domain this agent works in

Traces are linked back to agents via `PRODUCED_BY`.

```
(Agent: legal-agent) --MEMBER_OF--> (Project: enterprise-ops)
                      --OPERATES_IN--> (Domain: legal)

(DecisionTrace) --PRODUCED_BY--> (Agent: legal-agent)
```

## Setting Up Agents

When creating a context graph, specify the agent name:

```typescript
const contextGraph = await createContextGraph({
  tenant: "my_company",
  project: "enterprise-ops",
  domain: "legal",
  agent: "legal-agent",
  agentDescription: "Reviews contracts and checks compliance",
  embedding: { provider, dimensions: 1536 },
});
```

The middleware will automatically:
1. Create/merge the Agent node
2. Link it to the Project and Domain
3. Tag all captured traces with `PRODUCED_BY` this agent

## Context Sharing Policies

Control how agents share decision traces within a project:

### Shared (Default)
All agents see all traces in the project. Best for collaborative agents.

```typescript
const cg = await createContextGraph({
  // ...
  agent: "support-agent",
  contextSharing: "shared",
});
```

### Isolated
Agents only see their own traces. Best for independent agents or privacy-sensitive domains.

```typescript
const cg = await createContextGraph({
  // ...
  agent: "medical-agent",
  contextSharing: "isolated",
});
```

### Selective
Agents see their own traces plus traces from explicitly allowed agents. Best for controlled cross-domain learning.

```typescript
const cg = await createContextGraph({
  // ...
  agent: "legal-agent",
  contextSharing: "selective",
  allowedAgents: ["compliance-agent", "hr-agent"],
});
```

## Cross-Pollination

When using `shared` or `selective` policies, agents can learn from each other:

1. **Legal Agent** learns that "user prefers email over phone" from a Support Agent's trace
2. **Medical Agent** learns about drug interaction patterns from another Medical Agent
3. **Tech Agent** inherits deployment best practices from a DevOps Agent

This is enabled automatically through:
- Concept tags linking related traces across agents
- Vector similarity search finding relevant traces regardless of origin agent
- Precedent links connecting similar decisions across domains

## Querying Agent Data

```typescript
// Get all agents in a project
const agents = await contextGraph.store.getAgentsByProject();

// Get tool usage statistics for a specific agent
const toolStats = await contextGraph.store.getToolStatsByAgent("legal-agent");

// Get project-wide tool statistics
const allToolStats = await contextGraph.store.getToolStats();
```

## Example: Three-Agent System

See [examples/multi-domain-agents.ts](../examples/multi-domain-agents.ts) for a complete working example with:
- **Legal Agent** — contract review and compliance checks
- **Medical Agent** — patient history and drug interaction analysis
- **Tech Agent** — system metrics and diagnostics

Run it with:
```bash
npm run example:multi-domain
```
