# Schema Inspector

Agents need to understand the shape of their own context graph -- what entity types they've created, how many there are, and what relationships connect them. Without schema awareness, agents risk creating duplicate entity types, using inconsistent naming, or missing existing knowledge.

The Schema Inspector provides three capabilities:
1. **Automatic injection** -- agent-scoped schema overview is added to the system prompt
2. **`inspect_schema` tool** -- agents can check their own schema on demand
3. **`query_graph` tool** -- freeform Cypher read queries for graph exploration

## Agent-Scoped Schema

The schema is scoped to the agent that owns the context. Each agent only sees entity types and relationships it has created (`CREATED_BY`) or produced (`PRODUCED_BY`). This means:

- **Agent A** creates `CodeFile` and `Function` entities -- only Agent A sees these in its schema
- **Agent B** creates `Contract` and `Regulation` entities -- only Agent B sees these
- Internal structural types (`Agent`, `Project`) and plumbing relationships (`MEMBER_OF`, `BELONGS_TO_PROJECT`, `CREATED_BY`, `PRODUCED_BY`) are filtered out

This ensures the schema injected into the system prompt **guides only the agent that owns the context** -- other agents' entity structures are not leaked.

When no agent name is configured, the schema falls back to project scope (all entities linked to the project).

## Why Schema Awareness Matters

Consider a coding agent that creates a `SourceFile` entity, not knowing a `CodeFile` label already exists from a previous session. Without schema awareness, the graph ends up with two labels for the same concept, fragmenting knowledge.

The schema inspector prevents this by showing the agent what it has already built before creating new entities.

## Automatic Prompt Injection

The prompt injector automatically includes the agent's schema overview in the system prompt when entities exist:

```
## Your Brain Map (Context Graph Schema)
These are the entity types and relationships you have created or produced.
Use this to understand what you already know and build on it coherently.

**Entity Types:**
  - DecisionTrace (12 nodes)
  - Intent (12 nodes)
  - CodeFile (5 nodes)

**Relationship Types:**
  - HAS_INTENT (12 edges)
  - IMPORTS (3 edges)
```

This is handled by `formatSchemaForPrompt()`:

```typescript
import { formatSchemaForPrompt } from "graphmind-context-graphs";

const schema = await contextGraph.store.getSchemaOverview();
const section = formatSchemaForPrompt(schema);
// Returns the formatted string, or "" if the graph is empty
```

## getSchemaOverview()

The `GraphmindStore.getSchemaOverview()` method returns a `SchemaOverview` scoped to the configured agent:

```typescript
interface SchemaOverview {
  nodeLabels: string[];                    // e.g., ["DecisionTrace", "CodeFile"]
  relationshipTypes: string[];             // e.g., ["HAS_INTENT", "IMPORTS"]
  nodeCounts: Record<string, number>;      // e.g., { DecisionTrace: 12 }
  edgeCounts: Record<string, number>;      // e.g., { HAS_INTENT: 12 }
}
```

How scoping works internally:
- **With agent name** -- queries nodes connected via `CREATED_BY` (dynamic entities) and `PRODUCED_BY` (decision traces), plus nodes reachable from those traces (Intent, Constraint, Action, Concept, etc.)
- **Without agent name** -- queries all nodes linked to the project via `BELONGS_TO_PROJECT`

```typescript
const schema = await contextGraph.store.getSchemaOverview();

// Only shows what THIS agent has built
console.log(schema.nodeLabels);
// ["DecisionTrace", "Intent", "Action", "CodeFile"]
// Does NOT include entities created by other agents
```

## inspect_schema Tool

The `inspect_schema` tool lets agents check their own schema on demand. It is included automatically in the tools returned by `createContextGraph()`:

```typescript
const contextGraph = await createContextGraph({
  tenant: "my_company",
  project: "codebase-analysis",
  agent: "coding-agent",
  embedding: { provider, dimensions: 1536 },
});

// contextGraph.tools includes inspect_schema, query_graph,
// create_entity, create_relationship, find_entities

const agent = createAgent({
  model: "claude-sonnet-4-6",
  tools: [...myTools, ...contextGraph.tools],
  middleware: contextGraph.middleware,
});
```

When the agent calls `inspect_schema`, it receives only its own entities:

```
# Your Context Graph Schema

## Entity Types (Node Labels)
- **DecisionTrace**: 12 node(s)
- **Intent**: 12 node(s)
- **CodeFile**: 5 node(s)

## Relationship Types
- **HAS_INTENT**: 12 edge(s)
- **IMPORTS**: 3 edge(s)

## Guidelines
- Before creating a new entity type, check if a similar one already exists above.
- Use existing relationship types when they fit.
- Entity labels should be PascalCase (e.g., CodeFile, APIEndpoint).
- Relationship types should be UPPER_SNAKE_CASE (e.g., DEPENDS_ON, IMPORTS).
```

If the graph is empty for this agent, the tool responds with a discovery-mode message encouraging the agent to start building.

## Multi-Agent Schema Isolation

In a multi-agent system, each agent sees only its own brain map:

```typescript
// coding-agent sees: CodeFile, Function, Dependency
const codingSchema = await codingCG.store.getSchemaOverview();

// security-agent sees: Vulnerability, SecurityRule, ThreatModel
const securitySchema = await securityCG.store.getSchemaOverview();

// They share DECISION TRACES (via contextSharing policy)
// but NOT entity schemas -- each brain map is independent
```

This is intentional: decision traces carry the *reasoning* across agents, while the brain map carries the *structure* and stays agent-local.

## query_graph Tool

The `query_graph` tool allows agents to run freeform **read-only** Cypher queries against the context graph. This is useful for exploring specific patterns, finding connections, or verifying state before making decisions.

```typescript
// Agent calls query_graph with:
{
  query: "MATCH (f:CodeFile)-[:IMPORTS]->(dep:CodeFile) RETURN f.name, dep.name LIMIT 10",
  description: "Find import relationships between code files"
}
```

Only read operations are allowed (MATCH, RETURN, etc.). CREATE, DELETE, and SET are rejected. The tool formats results as readable text.

Note: `query_graph` operates on the full graph namespace, not agent-scoped. This means agents can query entities created by other agents if they know the labels. This is by design -- agents should be able to explore the full graph when they actively choose to, but the schema *injected into their prompt* only shows their own entities to prevent confusion.
