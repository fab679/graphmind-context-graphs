# Contextual Registry

The Contextual Registry is the semantic retrieval and storage layer of the context graph. It handles embedding generation, vector search, trace storage, precedent linking, and cold start detection.

## Key Operations

### `getRelevantContext(intentDescription)`

Retrieves all contextually relevant information for the current task. This is the primary read path -- called by the prompt injector before every model call.

```typescript
const context = await registry.getRelevantContext("Deploy the API to production");
// Returns: { pastTraces, rules, antiPatterns, skills, schema }
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

### `recordDecision(trace)`

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

### `isDiscoveryMode()`

Detects cold start conditions. Returns `true` when no traces exist for the current project.

```typescript
if (await registry.isDiscoveryMode()) {
  // First run -- capture everything at baseline confidence
}
```

The result is cached until `recordDecision()` is called, avoiding repeated database queries.

## Semantic Generalization

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
