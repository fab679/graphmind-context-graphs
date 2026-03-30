# Data Model

Context Graphs are **Director's Commentary** for AI agents. They don't store transcripts of what happened -- they capture **why** decisions were made, mapping the relationships between intents, constraints, actions, and justifications. Over time, an agent builds a brain map of its domain, discovering entities and relationships dynamically.

## The Triplet Model

Every decision captured by the middleware is decomposed into four components that form a **decision trace**.

### Intent

The goal or desired outcome that triggered the decision.

```typescript
interface Intent {
  id?: string;
  description: string;    // "Deploy application to production"
  embedding?: number[];   // Auto-generated semantic vector
  createdAt: string;
}
```

### Constraint

A condition that shaped the decision. Constraints are classified into three universal logic classes:

```typescript
interface Constraint {
  id?: string;
  description: string;    // "Tests must pass before deploy"
  type: "blocker" | "permission" | "pivot";
  embedding?: number[];
  createdAt: string;
}
```

| Type | Meaning | Examples |
|------|---------|---------|
| `blocker` | Something preventing progress | timeout, error, missing dependency |
| `permission` | Something enabling or gating access | auth required, approval granted |
| `pivot` | A context shift that changes the approach | new requirements, urgency change |

### Action

The move taken in response to the intent and constraints.

```typescript
interface Action {
  id?: string;
  description: string;    // "Ran CI/CD pipeline with rollback enabled"
  outcome?: "success" | "failure" | "pending";
  embedding?: number[];
  createdAt: string;
}
```

### Justification

The reasoning that connects everything -- the "why" behind the decision.

```typescript
interface Justification {
  description: string;    // "Deployed with rollback because staging had intermittent failures"
  confidence: number;     // 0-1, increases through the knowledge lifecycle
  ablationScore?: number; // How critical this justification is (from ablation filter)
}
```

## DecisionTrace: The Central Node

The `DecisionTrace` is the core node of the context graph. It combines all four triplet components with metadata for scoping and lifecycle management.

```typescript
interface DecisionTrace {
  id?: string;
  intent: Intent;
  constraints: Constraint[];
  action: Action;
  justification: Justification;
  toolCalls?: ToolCall[];     // Tool invocations captured during this decision
  project: string;
  tenant: string;
  domain?: string;            // Stored as relationship to Domain node
  agent?: string;             // Stored as relationship to Agent node
  concepts?: string[];        // Semantic tags linking related traces
  status: TraceStatus;        // Lifecycle stage
  embedding?: number[];       // Combined trace embedding for similarity search
  createdAt: string;
  updatedAt: string;
}

type TraceStatus = "captured" | "validated" | "synthesized" | "anti_pattern" | "pruned";
```

## Supporting Entities

### Agent

Represents an agent in a multi-agent system. Linked to projects and domains.

```typescript
interface Agent {
  id?: string;
  name: string;           // "legal-agent"
  description?: string;   // "Reviews contracts and checks compliance"
  createdAt: string;
}
```

### Domain

Groups traces and agents by domain. Exists as a separate node connected via relationships -- not stored as a property on traces.

```typescript
interface Domain {
  id?: string;
  name: string;           // "legal", "medical", "tech", "devops"
  description?: string;
  createdAt: string;
}
```

### Project

Scopes all work within a tenant. Every trace belongs to exactly one project.

```typescript
interface Project {
  id?: string;
  name: string;
  tenant: string;
  description?: string;
  createdAt: string;
}
```

### Concept

A semantic tag linking related decision traces across agents and domains.

```typescript
interface Concept {
  id?: string;
  name: string;           // "rate-limiting", "account-lockout"
  description?: string;
  embedding?: number[];   // For semantic concept search
  createdAt: string;
}
```

### ToolCall

Records individual tool invocations during a decision for visualization and usage statistics.

```typescript
interface ToolCall {
  id?: string;
  name: string;          // "search_knowledge_base"
  args: string;          // Serialized arguments
  result?: string;       // Tool result (truncated for storage)
  durationMs?: number;
  createdAt: string;
}
```

### Skill

A curated bundle of synthesized rules derived from decision traces. Auto-generated when related synthesized traces cluster around shared concepts. Agents discover and load skills on demand (progressive disclosure).

```typescript
interface Skill {
  id?: string;
  name: string;          // "handle-locked-accounts"
  description: string;
  prompt: string;        // Compiled rules from constituent traces
  confidence: number;
  concepts: string[];
  tools: string[];       // Tool names commonly used by this skill
  traceCount: number;    // Number of synthesized traces backing this skill
  domain?: string;
  createdAt: string;
  updatedAt: string;
}
```

## Dynamic Entities: The Brain Map

Beyond the fixed triplet model, agents create **dynamic entities** to map their understanding of a domain. These are freeform and domain-specific -- an agent working on a codebase might create `CodeFile` and `APIEndpoint` nodes, while a legal agent might create `Contract` and `Clause` nodes.

### GraphEntity

```typescript
interface GraphEntity {
  id?: string;
  label: string;          // PascalCase node label: "CodeFile", "Patient", "Contract"
  properties: Record<string, string | number | boolean>;
  createdBy?: string;     // Agent that created this entity
  createdAt: string;
}
```

### GraphRelationship

```typescript
interface GraphRelationship {
  id?: string;
  sourceId: string;       // Source entity ID
  targetId: string;       // Target entity ID
  type: string;           // "DEPENDS_ON", "TREATS", "IMPORTS"
  properties?: Record<string, string | number | boolean>;
  createdBy?: string;
  createdAt: string;
}
```

Dynamic entities are what make the graph a living brain map. As agents work, they build up a domain model that other agents (or the same agent in future sessions) can inspect and build on.

### SchemaOverview

Agents can introspect the graph schema to understand what entity types and relationships already exist, preventing duplication and maintaining coherence.

```typescript
interface SchemaOverview {
  nodeLabels: string[];                  // ["DecisionTrace", "Intent", "CodeFile", ...]
  relationshipTypes: string[];           // ["HAS_INTENT", "DEPENDS_ON", ...]
  nodeCounts: Record<string, number>;    // { "DecisionTrace": 42, "CodeFile": 15, ... }
  edgeCounts: Record<string, number>;    // { "HAS_INTENT": 42, "DEPENDS_ON": 8, ... }
}
```

## Context Sharing Policies

For multi-agent systems, context sharing controls which traces an agent can read:

```typescript
type ContextSharingPolicy = "shared" | "isolated" | "selective";
```

| Policy | Description |
|--------|-------------|
| `shared` | All agents in the project see all traces (default) |
| `isolated` | Agents only see their own traces |
| `selective` | Agents see their traces + traces from explicitly allowed agents |

## Graph Relationships

The full graph structure in the Graphmind database:

```
(Project) <-BELONGS_TO_PROJECT- (DecisionTrace) -BELONGS_TO_DOMAIN-> (Domain)
                                      |
                           PRODUCED_BY -> (Agent) -MEMBER_OF-> (Project)
                                                  -OPERATES_IN-> (Domain)
                           HAS_INTENT -> (Intent)
                           TOOK_ACTION -> (Action)
                           HAS_CONSTRAINT -> (Constraint)
                           USED_TOOL -> (ToolCall)
                           TAGGED_WITH -> (Concept)
                           PRECEDENT_OF -> (DecisionTrace)
                           CREATED_BY -> (Agent)   [for dynamic entities]
```

| Relationship | Source | Target | Description |
|-------------|--------|--------|-------------|
| `BELONGS_TO_PROJECT` | DecisionTrace | Project | Scopes trace to a project |
| `BELONGS_TO_DOMAIN` | DecisionTrace | Domain | Links trace to its domain |
| `PRODUCED_BY` | DecisionTrace | Agent | Which agent created this trace |
| `MEMBER_OF` | Agent | Project | Agent belongs to a project |
| `OPERATES_IN` | Agent | Domain | Agent works in a domain |
| `HAS_INTENT` | DecisionTrace | Intent | The goal of this decision |
| `TOOK_ACTION` | DecisionTrace | Action | The action taken |
| `HAS_CONSTRAINT` | DecisionTrace | Constraint | Constraints that applied |
| `USED_TOOL` | DecisionTrace | ToolCall | Tools invoked during this decision |
| `TAGGED_WITH` | DecisionTrace | Concept | Semantic tags linking traces |
| `PRECEDENT_OF` | DecisionTrace | DecisionTrace | Semantic similarity link |
| `CREATED_BY` | GraphEntity | Agent | Dynamic entity attribution |

Vector indexes on `Intent(embedding)`, `DecisionTrace(embedding)`, and `Concept(embedding)` enable semantic similarity search via the SEARCH clause.
