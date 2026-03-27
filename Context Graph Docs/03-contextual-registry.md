# Contextual Registry (The Store)

The Contextual Registry orchestrates reading and writing of decision traces, handling semantic generalization, cold start detection, and context sharing between agents.

## Key Operations

### `getRelevantContext(intentDescription)`

Retrieves contextually relevant information for the current agent task:

1. Embeds the intent description using the configured embedding provider
2. Performs vector search against past `DecisionTrace` embeddings via Graphmind's SEARCH clause
3. Fetches active rules (synthesized traces with high confidence)
4. Fetches anti-patterns (traces marked as failures)

**Context sharing policies affect which traces are returned:**
- `shared` — searches all traces in the project
- `isolated` — searches only the current agent's traces
- `selective` — searches traces from the current agent + allowed agents

Returns a `FormattedContext` object containing:
- `pastTraces` - Similar past decisions with similarity scores
- `rules` - Established patterns to follow
- `antiPatterns` - Approaches to avoid

### `recordDecision(trace)`

Saves a new decision trace with full embedding generation:

1. Generates embeddings for the combined trace text, intent, constraints, and action
2. Saves the trace and all related nodes to the Graphmind database:
   - Links trace to **Project** node via `BELONGS_TO_PROJECT`
   - Links trace to **Domain** node via `BELONGS_TO_DOMAIN`
   - Links trace to **Agent** node via `PRODUCED_BY`
   - Creates **Constraint** nodes linked via `HAS_CONSTRAINT`
   - Creates **ToolCall** nodes linked via `USED_TOOL`
   - Creates **Concept** nodes linked via `TAGGED_WITH`
3. Runs **semantic generalization** - searches for similar past traces and creates `PRECEDENT_OF` links

### `isDiscoveryMode()`

Detects cold start conditions. Returns `true` if no traces exist for the current project. The result is cached until a new decision is recorded.

## Semantic Generalization

When a new trace is saved, the registry automatically searches for similar past traces. If similarity exceeds the configured threshold (default: 0.7), it creates a `PRECEDENT_OF` edge between them.

This enables:
- **Pattern detection** - Traces with many precedent links indicate recurring decisions
- **Cross-domain learning** - Similar decisions across domains within a project are linked via concepts
- **Rule synthesis** - The lifecycle manager uses precedent links to identify promotion candidates

## Configuration

| Option | Default | Description |
|--------|---------|-------------|
| `vectorSearchLimit` | 5 | Number of similar traces to retrieve |
| `similarityThreshold` | 0.7 | Minimum similarity for precedent linking |
| `contextSharing` | `"shared"` | Context sharing policy for multi-agent systems |
| `allowedAgents` | `[]` | Agent names allowed to share context (for `selective` policy) |
