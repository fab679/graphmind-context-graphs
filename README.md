# Graphmind Context Graphs

A Context Graph middleware for LangChain AI agents. Unlike standard memory that stores **what** happened (transcripts), this middleware captures **why** it happened (Decision Traces). It maps the relationships between Intents, Constraints, and Actions across any domain.

## Features

- **Decision Trace Capture** - Automatically records agent reasoning as structured Intent/Constraint/Action triplets
- **Tool Call Tracking** - Records individual tool invocations as graph nodes for visualization and analytics
- **Ablation Filtering** - Observer LLM identifies which facts actually changed the decision (noise reduction)
- **Dynamic Prompt Injection** - Injects relevant past reasoning into agent prompts as "Director's Commentary"
- **Knowledge Lifecycle** - Capture → Validate → Synthesize → Prune pipeline for evolutionary knowledge distillation
- **Skills (Progressive Disclosure)** - Auto-synthesized skill bundles agents can discover and load on-demand
- **Multi-Agent** - Agent nodes with configurable context sharing (shared, isolated, selective)
- **Multi-Tenant** - Full data isolation per tenant via Graphmind graph namespaces
- **Multi-Project** - Separate project contexts within a tenant
- **Cross-Domain** - Concept tags link similar decisions across legal, medical, tech, and any other domain
- **Vector Search** - Semantic similarity retrieval of past decision traces via Graphmind SEARCH clause

## Installation

```bash
npm install graphmind-context-graphs
```

### Peer Dependencies

```bash
npm install langchain @langchain/core @langchain/langgraph
```

### Prerequisites

- A running [Graphmind](https://github.com/fabischkamern/graphmind) instance:

```bash
docker run -d --name graphmind -p 8080:8080 fabischk/graphmind:latest
```

## Quick Start

```typescript
import { createAgent, tool } from "langchain";
import { z } from "zod";
import { createContextGraph } from "graphmind-context-graphs";
import type { EmbeddingProvider } from "graphmind-context-graphs";

// 1. Create an embedding provider (use your preferred model)
const embeddingProvider: EmbeddingProvider = {
  embed: async (text) => await yourEmbeddingModel.embed(text),
  embedBatch: async (texts) => await yourEmbeddingModel.embedBatch(texts),
  dimensions: 1536,
};

// 2. Initialize the context graph
const contextGraph = await createContextGraph({
  tenant: "my_company",
  project: "customer_support",
  agent: "support-agent",                // Agent name for multi-agent tracking
  agentDescription: "Handles customer inquiries",
  domain: "support",                      // Or omit to auto-infer
  embedding: {
    provider: embeddingProvider,
    dimensions: 1536,
  },
  observerModel: "openai:gpt-4.1-mini",  // For ablation filtering (optional)
});

// 3. Create your agent with context graph middleware
const agent = createAgent({
  model: "openai:gpt-4.1",
  tools: [
    tool(
      ({ query }) => `Results for: ${query}`,
      {
        name: "search",
        description: "Search the knowledge base",
        schema: z.object({ query: z.string() }),
      }
    ),
  ],
  middleware: contextGraph.middleware,
});

// 4. Use the agent - context is captured and injected automatically
const result = await agent.invoke({
  messages: [{ role: "user", content: "How do I reset my password?" }],
});

// 5. Validate outcomes and evolve knowledge
await contextGraph.lifecycle.validateTrace("trace-id", {
  traceId: "trace-id",
  success: true,
});
await contextGraph.lifecycle.synthesizeRules();
await contextGraph.lifecycle.pruneFailures();
```

## Configuration

```typescript
interface ContextGraphConfig {
  graphmind?: {
    url?: string;          // Graphmind server URL (env: GRAPHMIND_URL)
    token?: string;        // Bearer auth token (env: GRAPHMIND_TOKEN)
    username?: string;     // Basic auth username (env: GRAPHMIND_USERNAME)
    password?: string;     // Basic auth password (env: GRAPHMIND_PASSWORD)
  };
  tenant: string;                  // Tenant identifier (maps to graph namespace)
  project: string;                 // Project identifier (within tenant)
  domain?: string;                 // Explicit domain, or auto-inferred
  agent?: string;                  // Agent name for multi-agent systems
  agentDescription?: string;       // Human-readable agent role
  contextSharing?: ContextSharingPolicy;  // "shared" | "isolated" | "selective"
  allowedAgents?: string[];        // Agents to share with (selective mode)
  embedding: {
    provider: EmbeddingProvider;   // Your embedding implementation
    dimensions: number;            // Vector dimensions
    metric?: "cosine" | "l2" | "dot";
  };
  observerModel?: string;         // Model for ablation filtering
  vectorSearchLimit?: number;     // Top-k results (default: 5)
  similarityThreshold?: number;   // Min similarity for precedent linking (default: 0.7)
  baseSystemPrompt?: string;      // Base system prompt
  debug?: boolean;
}
```

### Environment Variables

Configuration can be provided via environment variables (loaded from `.env` automatically):

| Variable | Description |
|----------|-------------|
| `GRAPHMIND_URL` | Graphmind server URL (default: `http://localhost:8080`) |
| `GRAPHMIND_TOKEN` | Bearer auth token |
| `GRAPHMIND_USERNAME` | Basic auth username |
| `GRAPHMIND_PASSWORD` | Basic auth password |
| `OPENAI_API_KEY` | Required for embedding provider and observer model |

## Architecture

The middleware operates as a stateful proxy between the user and the LangChain agent:

```
User → [Prompt Injector] → Agent → [Reasoning Extractor] → Context Graph DB
         ↑ Injects past                   ↓ Captures new
         reasoning traces                 decision traces
```

### Graph Structure

```
(Project) <-BELONGS_TO_PROJECT- (DecisionTrace) -BELONGS_TO_DOMAIN-> (Domain)
                                      |
                           PRODUCED_BY-> (Agent) -MEMBER_OF-> (Project)
                                                 -OPERATES_IN-> (Domain)
                           HAS_INTENT-> (Intent)
                           TOOK_ACTION-> (Action)
                           HAS_CONSTRAINT-> (Constraint)
                           USED_TOOL-> (ToolCall)
                           TAGGED_WITH-> (Concept)
                           PRECEDENT_OF-> (DecisionTrace)
                           CONTRIBUTES_TO-> (Skill)

(Skill) -BELONGS_TO_PROJECT-> (Project)
         -DERIVED_FROM_CONCEPT-> (Concept)
         -BELONGS_TO_DOMAIN-> (Domain)
```

### The Triplet Data Model

Every decision is captured as a structured triplet:

| Component | Description | Example |
|-----------|-------------|---------|
| **Intent** | The desired end-state | "Reset user password" |
| **Constraint** | Blockers or rules | "Account is locked", "2FA required" |
| **Action** | The move taken | "Sent reset email via admin panel" |
| **Justification** | THE "WHY" | "Admin panel bypass used because account was locked" |

### Core Components

1. **Reasoning Extractor** - LangChain middleware that captures agent reasoning, tool calls, and facts
2. **Ablation Filter** - Observer LLM that determines which facts are critical to the decision
3. **Contextual Registry** - Manages semantic generalization, precedent linking, and context sharing
4. **Prompt Injector** - Injects relevant past logic, established rules, and anti-patterns into prompts
5. **Knowledge Lifecycle Manager** - Validates traces, promotes rules, and prunes anti-patterns

### Knowledge Lifecycle

```
Capture → Validate → Synthesize → Prune → Skill Synthesis
  ↓          ↓           ↓          ↓          ↓
Record    Observe     Promote    Mark as    Cluster rules
trace     outcome     to rule    anti-pat.  into skills
```

## Skills (Progressive Disclosure)

Skills are curated bundles of validated decision patterns, auto-synthesized when multiple synthesized traces share a concept. Agents discover skills via a lightweight manifest and load them on-demand.

```typescript
// After promoting rules, auto-create skills
await contextGraph.lifecycle.synthesizeRules();
const skills = await contextGraph.lifecycle.synthesizeSkills();
// ["handle-account-lockout", "handle-rate-limiting"]

// Add skill tools to your agent for on-demand loading
import { createSkillTool, createListSkillsTool } from "graphmind-context-graphs";

const agent = createAgent({
  model: "openai:gpt-4.1",
  tools: [
    ...yourTools,
    createSkillTool(contextGraph.store),      // load_skill tool
    createListSkillsTool(contextGraph.store),  // list_skills tool
  ],
  middleware: contextGraph.middleware,
});
```

The prompt injector automatically injects a skill manifest. When the agent recognizes a relevant skill, it calls `load_skill("handle-account-lockout")` to get the full context.

## Multi-Agent Systems

Multiple agents can share a project with configurable context sharing:

```typescript
// Legal agent — shares context with compliance agent only
const legalCG = await createContextGraph({
  tenant: "enterprise",
  project: "ops",
  domain: "legal",
  agent: "legal-agent",
  contextSharing: "selective",
  allowedAgents: ["compliance-agent"],
  embedding: { provider, dimensions: 1536 },
});

// Medical agent — isolated, sees only its own traces
const medicalCG = await createContextGraph({
  tenant: "enterprise",
  project: "ops",
  domain: "medical",
  agent: "medical-agent",
  contextSharing: "isolated",
  embedding: { provider, dimensions: 1536 },
});

// Tech agent — shared, sees all traces in the project
const techCG = await createContextGraph({
  tenant: "enterprise",
  project: "ops",
  domain: "tech",
  agent: "tech-agent",
  contextSharing: "shared",
  embedding: { provider, dimensions: 1536 },
});
```

### Context Sharing Policies

| Policy | Description | Use Case |
|--------|-------------|----------|
| `shared` | All agents see all traces (default) | Collaborative teams |
| `isolated` | Agents see only their own traces | Privacy-sensitive domains |
| `selective` | Agents see own + allowed agents' traces | Controlled cross-domain learning |

## Multi-Tenancy

Each tenant gets a fully isolated Graphmind graph namespace:

```typescript
// Tenant A - completely isolated
const tenantA = await createContextGraph({
  tenant: "company_alpha",
  project: "support",
  embedding: { provider, dimensions: 1536 },
});

// Tenant B - separate graph, no data leakage
const tenantB = await createContextGraph({
  tenant: "company_beta",
  project: "support",
  embedding: { provider, dimensions: 1536 },
});
```

## API Reference

### `createContextGraph(config)`

Factory function that initializes the context graph and returns:

| Property | Type | Description |
|----------|------|-------------|
| `middleware` | `Middleware[]` | Array of LangChain middleware to pass to `createAgent()` |
| `registry` | `ContextualRegistry` | Direct access to context read/write operations |
| `lifecycle` | `KnowledgeLifecycleManager` | Validate, synthesize, and prune traces |
| `store` | `GraphmindStore` | Direct database access for advanced queries |

### `GraphmindStore`

| Method | Description |
|--------|-------------|
| `getToolStats()` | Get tool usage statistics for the project |
| `getToolStatsByAgent(name)` | Get tool usage statistics for a specific agent |
| `getAgentsByProject()` | Get all agents in the project |
| `getConceptsByProject()` | Get all concept tags with trace counts |
| `getTracesByConcept(name)` | Get all traces tagged with a concept |
| `tagTraceWithConcept(id, name)` | Tag a trace with a concept |
| `getSkillsByProject()` | Get all skills for the project |
| `getSkillByName(name)` | Get a specific skill with full details |
| `findSimilarTraces(vector, limit?)` | Vector similarity search (respects sharing policy) |

### `KnowledgeLifecycleManager`

| Method | Description |
|--------|-------------|
| `validateTrace(id, result)` | Record whether a trace's outcome was successful |
| `synthesizeRules(options?)` | Promote high-confidence validated traces to permanent rules |
| `synthesizeSkills(minTraces?)` | Auto-create skills from clustered synthesized traces |
| `pruneFailures(options?)` | Mark low-confidence traces as anti-patterns |
| `getLifecycleStats()` | Get counts by status (captured, validated, synthesized, etc.) |

### `ContextualRegistry`

| Method | Description |
|--------|-------------|
| `getRelevantContext(intent)` | Retrieve past traces, rules, and anti-patterns by semantic similarity |
| `recordDecision(trace)` | Save a new decision trace with auto-generated embeddings |
| `isDiscoveryMode()` | Check if this is the first-ever decision (no prior traces) |

## Examples

### Single-Agent Support Demo

```bash
npm run example
```

Runs a helpdesk agent through three conversations (locked account, another locked account, API rate limits) demonstrating trace capture, context injection, and concept tagging.

### Multi-Domain Agent Demo

```bash
npm run example:multi-domain
```

Runs three agents (legal, medical, tech) in the same project demonstrating:
- Cross-domain context sharing
- Domain-specific tool usage
- Agent and tool call visualization
- Concept tags linking traces across domains

## Documentation

See the [Context Graph Docs](Context%20Graph%20Docs/) for detailed documentation:

1. [Data Model](Context%20Graph%20Docs/01-data-model.md) - Triplet model, node types, graph structure
2. [Reasoning Extractor](Context%20Graph%20Docs/02-reasoning-extractor.md) - How agent reasoning is captured
3. [Contextual Registry](Context%20Graph%20Docs/03-contextual-registry.md) - Context retrieval and semantic generalization
4. [Prompt Injector](Context%20Graph%20Docs/04-prompt-injector.md) - How past context is injected into prompts
5. [Knowledge Lifecycle](Context%20Graph%20Docs/05-knowledge-lifecycle.md) - Capture → Validate → Synthesize → Prune
6. [Multi-Agent Systems](Context%20Graph%20Docs/06-multi-agent.md) - Agent nodes and context sharing policies
7. [Tool Call Tracking](Context%20Graph%20Docs/07-tool-calls.md) - Tool usage visualization and statistics
8. [Skills](Context%20Graph%20Docs/08-skills.md) - Progressive disclosure with auto-synthesized skills

## Testing

```bash
# Run unit tests
npm test

# Run integration tests (requires running Graphmind)
GRAPHMIND_URL=http://localhost:8080 npm run test:integration

# Run example agent tests (requires Graphmind + OpenAI API key)
GRAPHMIND_URL=http://localhost:8080 OPENAI_API_KEY=sk-... npm run test:examples
```

## Development

```bash
# Install dependencies
npm install

# Type check
npm run lint

# Build
npm run build

# Watch mode
npm run dev
```

## License

MIT
