# Graphmind Context Graphs

A "Director's Commentary" middleware for AI agents. Unlike standard memory that stores **what** happened (transcripts), Context Graphs capture **why** it happened — decision traces that map the reasoning between Intents, Constraints, and Actions across any domain.

Agents don't just remember — they build a map of their own brain over time.

## What Makes This Different

| Standard Memory | Context Graphs |
|---|---|
| Stores transcripts | Stores **decision reasoning** |
| Static schema | **Dynamic entities** — agents create their own |
| No context across sessions | **Semantic retrieval** of past decisions |
| Knowledge grows noisy | Knowledge is **curated** (validate, synthesize, prune) |
| Agents start fresh | Agents inherit **institutional wisdom** |

## Features

- **Decision Trace Capture** — Automatically records agent reasoning as structured Intent/Constraint/Action/Justification triplets
- **Dynamic Brain Mapping** — Agents create arbitrary entities and relationships as they discover domain knowledge
- **Schema Awareness** — Agents inspect the graph schema before creating entities, preventing ambiguity
- **LLM-Powered Extraction** — Observer model extracts domain, concepts, and constraints intelligently (not regex)
- **Ablation Filtering** — Observer LLM identifies which facts actually changed the decision (noise reduction)
- **Dynamic Prompt Injection** — Injects schema overview, past reasoning, rules, and anti-patterns into prompts
- **Knowledge Lifecycle** — Capture → Validate → Synthesize → Prune for evolutionary distillation
- **Skills (Progressive Disclosure)** — Auto-synthesized skill bundles agents can discover and load on-demand
- **Multi-Agent** — Configurable context sharing (shared, isolated, selective)
- **Multi-Tenant** — Full data isolation per tenant via Graphmind graph namespaces
- **Vector Search** — Semantic similarity retrieval via Graphmind SEARCH clause

## Installation

```bash
npm install graphmind-context-graphs
```

### Peer Dependencies

```bash
npm install langchain @langchain/core @langchain/langgraph
```

### Prerequisites

A running [Graphmind](https://github.com/fabischkamern/graphmind) instance:

```bash
docker run -d --name graphmind -p 8080:8080 fabischk/graphmind:latest
```

## Quick Start

```typescript
import { createAgent } from "langchain";
import { createContextGraph } from "graphmind-context-graphs";
import type { EmbeddingProvider } from "graphmind-context-graphs";

// 1. Create an embedding provider
const embeddingProvider: EmbeddingProvider = {
  embed: async (text) => await yourModel.embed(text),
  embedBatch: async (texts) => await yourModel.embedBatch(texts),
  dimensions: 1536,
};

// 2. Initialize the context graph
const cg = await createContextGraph({
  tenant: "my_company",
  project: "support",
  agent: "support-agent",
  embedding: {
    provider: embeddingProvider,
    dimensions: 1536,
  },
  observerModel: "openai:gpt-4.1-mini", // Optional: enables LLM extraction + ablation
});

// 3. Create your agent with middleware AND brain-mapping tools
const agent = createAgent({
  model: "openai:gpt-4.1",
  tools: [...yourTools, ...cg.tools],  // Includes schema inspector + entity builder
  middleware: cg.middleware,            // Prompt injection + reasoning extraction
});

// 4. Use the agent — context is captured and injected automatically
const result = await agent.invoke({
  messages: [{ role: "user", content: "How do I reset my password?" }],
});

// 5. Evolve knowledge over time
await cg.lifecycle.validateTrace(traceId, { traceId, success: true });
await cg.lifecycle.synthesizeRules();
await cg.lifecycle.pruneFailures();
```

## How It Works

```
User → [Prompt Injector] → Agent → [Reasoning Extractor] → Context Graph DB
         ↑ Injects:                    ↓ Captures:
         - Schema overview             - Decision traces
         - Past reasoning              - Tool calls
         - Rules & anti-patterns       - Domain entities
         - Skills manifest             - Concepts & relationships
```

### The Triplet Data Model

Every decision is captured as a structured triplet:

| Component | Description | Example |
|---|---|---|
| **Intent** | The desired end-state | "Reset user password" |
| **Constraint** | Blockers or rules | "Account is locked", "2FA required" |
| **Action** | The move taken | "Sent reset email via admin panel" |
| **Justification** | THE "WHY" | "Admin panel bypass used because account was locked" |

### Dynamic Brain Mapping

The key differentiator: agents create entities that aren't known ahead of time.

```typescript
// A coding agent discovers codebase structure:
// create_entity({ label: "CodeFile", properties: { path: "src/auth/login.ts", purpose: "Authentication entry point" }})
// create_entity({ label: "Constraint", properties: { name: "rate-limiting", reason: "Added after brute-force incident" }})
// create_relationship({ source_id: "1", target_id: "2", relationship_type: "ENFORCES" })

// A legal agent maps contract structure:
// create_entity({ label: "Contract", properties: { name: "DataCorp Agreement", type: "vendor" }})
// create_entity({ label: "Regulation", properties: { name: "GDPR", jurisdiction: "EU" }})
// create_relationship({ source_id: "3", target_id: "4", relationship_type: "GOVERNED_BY" })
```

Agents use `inspect_schema` to see what entities already exist before creating new ones, preventing ambiguity.

### Knowledge Lifecycle

```
Capture → Validate → Synthesize → Prune
  ↓          ↓           ↓          ↓
Record    Observe     Promote    Mark as
trace     outcome     to rule    anti-pattern
```

Raw traces evolve into institutional wisdom through validation and synthesis. Failed approaches are pruned as anti-patterns.

## Agent Tools

`createContextGraph()` returns these tools automatically via `cg.tools`:

| Tool | Description |
|---|---|
| `inspect_schema` | View existing entity types and relationships in the graph |
| `query_graph` | Execute read-only Cypher queries to explore the graph |
| `create_entity` | Create a new entity node (CodeFile, Contract, etc.) |
| `create_relationship` | Connect two entities with a typed relationship |
| `find_entities` | Search existing entities by label and properties |

Additional skill tools (add separately):

```typescript
import { createSkillTool, createListSkillsTool } from "graphmind-context-graphs";

const agent = createAgent({
  tools: [
    ...cg.tools,
    createSkillTool(cg.store),      // load_skill
    createListSkillsTool(cg.store), // list_skills
  ],
  middleware: cg.middleware,
});
```

## Multi-Agent Systems

Multiple agents share a project with configurable context sharing:

```typescript
const legalCG = await createContextGraph({
  tenant: "enterprise", project: "ops",
  agent: "legal-agent", domain: "legal",
  contextSharing: "selective",
  allowedAgents: ["compliance-agent"],
  embedding: { provider, dimensions: 1536 },
});

const techCG = await createContextGraph({
  tenant: "enterprise", project: "ops",
  agent: "tech-agent", domain: "tech",
  contextSharing: "shared",  // Sees all traces including legal
  embedding: { provider, dimensions: 1536 },
});
```

| Policy | Description | Use Case |
|---|---|---|
| `shared` | All agents see all traces (default) | Collaborative teams |
| `isolated` | Agents see only their own traces | Privacy-sensitive domains |
| `selective` | Own + allowed agents' traces | Controlled cross-domain learning |

## Configuration

```typescript
interface ContextGraphConfig {
  graphmind?: {
    url?: string;       // Default: http://localhost:8080 (env: GRAPHMIND_URL)
    token?: string;     // Bearer auth (env: GRAPHMIND_TOKEN)
    username?: string;  // Basic auth (env: GRAPHMIND_USERNAME)
    password?: string;  // Basic auth (env: GRAPHMIND_PASSWORD)
  };
  tenant: string;                        // Tenant → graph namespace
  project: string;                       // Project scope within tenant
  domain?: string;                       // Explicit domain, or auto-inferred
  agent?: string;                        // Agent name for multi-agent
  agentDescription?: string;             // Human-readable agent role
  contextSharing?: ContextSharingPolicy; // "shared" | "isolated" | "selective"
  allowedAgents?: string[];              // For selective sharing
  embedding: {
    provider: EmbeddingProvider;
    dimensions: number;
    metric?: "cosine" | "l2" | "dot";
  };
  observerModel?: string;               // For LLM extraction + ablation filtering
  vectorSearchLimit?: number;            // Top-k results (default: 5)
  similarityThreshold?: number;          // Precedent linking threshold (default: 0.7)
  baseSystemPrompt?: string;
  debug?: boolean;
}
```

## Examples

```bash
# Basic decision trace capture & replay
npm run example

# Coding agent with brain mapping
npm run example:coding

# Multi-agent shared context
npm run example:multi-agent
```

## Documentation

See [Context Graph Docs](Context%20Graph%20Docs/) for detailed guides:

1. [Data Model](Context%20Graph%20Docs/01-data-model.md) — Triplet model, dynamic entities, graph structure
2. [Reasoning Extractor](Context%20Graph%20Docs/02-reasoning-extractor.md) — LLM-powered decision capture
3. [Contextual Registry](Context%20Graph%20Docs/03-contextual-registry.md) — Semantic retrieval and recording
4. [Prompt Injector](Context%20Graph%20Docs/04-prompt-injector.md) — Schema-aware dynamic prompt enrichment
5. [Knowledge Lifecycle](Context%20Graph%20Docs/05-knowledge-lifecycle.md) — Capture → Validate → Synthesize → Prune
6. [Multi-Agent Systems](Context%20Graph%20Docs/06-multi-agent.md) — Agent nodes and sharing policies
7. [Tool Call Tracking](Context%20Graph%20Docs/07-tool-calls.md) — Tool usage visualization and statistics
8. [Skills](Context%20Graph%20Docs/08-skills.md) — Progressive disclosure with auto-synthesized skills
9. [Schema Inspector](Context%20Graph%20Docs/09-schema-inspector.md) — Schema awareness and graph exploration
10. [Entity Builder](Context%20Graph%20Docs/10-entity-builder.md) — Dynamic brain mapping with custom entities

## Testing

```bash
npm test                    # Unit tests
npm run lint                # Type checking
npm run build               # Build for distribution
```

## Sponsor GraphMind

If GraphMind is useful to you, consider sponsoring:

https://github.com/sponsors/fab679

Your support helps improve performance, expand OpenCypher support, and build LLM-native graph features.

## License

Apache License 2.0
