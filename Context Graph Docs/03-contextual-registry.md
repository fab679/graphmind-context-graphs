# Contextual Registry

The Contextual Registry is the semantic retrieval and storage layer of the context graph. It handles embedding generation, vector search, trace storage, precedent linking, and cold start detection.

> **NEW: Runtime Tenant Support** — The registry now supports dynamic tenant switching via `RuntimeTenantContext`. When you pass a different tenant in the runtime context, the registry automatically creates and uses a new isolated graph for that tenant. See [Runtime Tenant Creation](#runtime-tenant-creation) below.

## Key Operations

### `getRelevantContext(intentDescription, runtimeEmbeddingProvider?, runtimeTenantContext?)`

Retrieves all contextually relevant information for the current task. This is the primary read path -- called by the prompt injector before every model call.

```typescript
const context = await registry.getRelevantContext("Deploy the API to production");
// Returns: { pastTraces, rules, antiPatterns, skills, schema }
```

With runtime tenant override:

```typescript
const context = await registry.getRelevantContext(
  "Deploy the API to production",
  undefined, // use default embedding provider
  { tenant: "customer-123", project: "production" } // runtime tenant context
);
// Automatically queries the graph for customer-123, creating it if needed
```

Steps:

1. Embeds the intent description using the configured embedding provider
2. Runs five queries in parallel:
   - **Vector search** against past `DecisionTrace` embeddings via Graphmind's SEARCH clause
   - **Active rules** -- synthesized traces with high confidence
   - **Anti-patterns** -- traces marked as failures
   - **Skills** -- curated skill bundles for the project
   - **Schema overview** -- current entity types and relationship types in the graph

**Context sharing policies** filter which traces are returned:

| Policy | Traces Visible |
|--------|---------------|
| `shared` | All traces in the project |
| `isolated` | Only the current agent's traces |
| `selective` | Current agent's traces + traces from allowed agents |

Returns a `FormattedContext` object:

```typescript
interface FormattedContext {
  pastTraces: ScoredDecisionTrace[];   // Similar past decisions with similarity scores
  rules: DecisionTrace[];              // Validated patterns to follow
  antiPatterns: DecisionTrace[];       // Approaches to avoid
  skills: Skill[];                     // Available skill bundles
  schema?: SchemaOverview;             // Current graph entity types and relationships
}
```

### `recordDecision(trace, runtimeEmbeddingProvider?, runtimeTenantContext?)`

Saves a new decision trace with full embedding generation and automatic precedent linking.

```typescript
const traceId = await registry.recordDecision({
  intent: { description: "Fix authentication timeout", createdAt: now },
  constraints: [{ description: "Token refresh failing", type: "blocker", createdAt: now }],
  action: { description: "Added retry logic with exponential backoff", outcome: "success", createdAt: now },
  justification: { description: "Token service was intermittently slow", confidence: 0.7 },
  project: "my-project",
  tenant: "my-tenant",
  domain: "tech",
  status: "captured",
});
```

With runtime tenant override:

```typescript
const traceId = await registry.recordDecision(
  { /* trace data */ },
  undefined,
  { tenant: "customer-123", project: "my-project", agent: "support-agent" }
);
// Automatically saves to customer-123's isolated graph
```

Steps:

1. **Generates embeddings** for the combined trace text, intent, each constraint, and action
2. **Saves the trace** and all related nodes to the database:
   - Links to **Project** via `BELONGS_TO_PROJECT`
   - Links to **Domain** via `BELONGS_TO_DOMAIN`
   - Links to **Agent** via `PRODUCED_BY`
   - Creates **Constraint** nodes via `HAS_CONSTRAINT`
   - Creates **ToolCall** nodes via `USED_TOOL`
   - Creates **Concept** nodes via `TAGGED_WITH`
3. **Runs semantic generalization** -- searches for similar past traces and creates precedent links
4. **Resets discovery mode cache** so the next check reflects the new trace

### `isDiscoveryMode(runtimeTenantContext?)`

Detects cold start conditions. Returns `true` when no traces exist for the current project.

```typescript
if (await registry.isDiscoveryMode()) {
  // First run -- capture everything at baseline confidence
}
```

With runtime tenant context:

```typescript
if (await registry.isDiscoveryMode({ tenant: "customer-123", project: "onboarding" })) {
  // First run for this specific customer
}
```

The result is cached per tenant until `recordDecision()` is called for that tenant, avoiding repeated database queries.

## Runtime Tenant Creation

The registry supports dynamic tenant switching through `RuntimeTenantContext`. When you pass a different tenant than the base configuration, the registry automatically:

1. **Creates a new store** for that tenant (if it doesn't exist)
2. **Bootstraps the schema** for the tenant's isolated graph
3. **Queries/saves** to the correct tenant's graph

### RuntimeTenantContext Interface

```typescript
interface RuntimeTenantContext {
  tenant?: string;           // Target tenant (creates new graph if different from base)
  project?: string;          // Project scope within the tenant
  agent?: string;          // Agent name for this request
  agentDescription?: string; // Human-readable agent role
  embedding?: {            // Optional: override embedding provider
    provider: EmbeddingProvider;
    dimensions: number;
  };
}
```

### Usage in Middleware

The middleware automatically extracts runtime tenant context from the request:

```typescript
// Agent initialized with base tenant
const cg = await createContextGraph({
  tenant: "base-tenant",
  project: "base-project",
  embedding: { provider, dimensions: 1536 },
});

const agent = createAgent({
  model: "openai:gpt-4.1",
  tools: cg.tools,
  middleware: cg.middleware,
});

// Request with different tenant automatically creates new graph
await agent.invoke(
  { messages: [{ role: "user", content: "Hello" }] },
  {
    context: {
      tenant: "customer-123",      // New tenant created on-demand
      project: "customer-project",
      agent: "support-agent",
    },
  }
);
```

### Multi-Tenant SaaS Use Case

Perfect for SaaS applications where each customer needs isolated context:

```typescript
// Single ContextGraphInstance handles all tenants
const cg = await createContextGraph({
  tenant: "default",
  project: "saas-app",
  embedding: { provider, dimensions: 1536 },
});

// Each request routes to the correct tenant's graph
async function handleRequest(customerId: string, message: string) {
  return await agent.invoke(
    { messages: [{ role: "user", content: message }] },
    { context: { tenant: customerId, project: "main" } }
  );
}
```

Each tenant gets complete data isolation via separate graph namespaces (e.g., `cg_customer123`, `cg_customer456`).

When a new trace is saved, the registry searches for similar past traces. If similarity exceeds the configured threshold (default: `0.7`), it creates a `PRECEDENT_OF` edge between the new trace and its predecessors.

This enables three things:

- **Pattern detection** -- traces with many precedent links indicate recurring decisions, candidates for promotion to "validated" or "synthesized" status
- **Cross-domain learning** -- similar decisions across domains within a project are connected via shared concepts
- **Rule synthesis** -- the knowledge lifecycle manager uses precedent links to identify traces ready for promotion

The registry searches the top 5 similar traces and links any that meet the threshold.

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `vectorSearchLimit` | `5` | Number of similar traces to retrieve |
| `similarityThreshold` | `0.7` | Minimum similarity for precedent linking |
| `contextSharing` | `"shared"` | Context sharing policy for multi-agent systems |
| `allowedAgents` | `[]` | Agent names for `selective` policy |

## Schema Context

Every call to `getRelevantContext()` includes a `SchemaOverview` of the current graph. This tells the agent what entity types and relationships already exist, enabling schema-aware decisions. The prompt injector formats this as the "Current Brain Map" section in the system prompt.
