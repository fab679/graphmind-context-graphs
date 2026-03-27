# Data Model

The Context Graph uses a **Triplet** data model to capture decision reasoning, augmented with ToolCall, Agent, Domain, Project, and Concept nodes for visualization, multi-agent systems, and cross-domain linking.

## The Triplet

Every decision captured by the middleware is decomposed into four components:

### Intent
The desired end-state or goal that triggered the decision.

```typescript
interface Intent {
  id?: string;
  description: string;    // e.g., "Deploy application to production"
  embedding?: number[];    // Auto-generated semantic vector
  createdAt: string;
}
```

### Constraint
Blockers, rules, or conditions that influenced the decision.

```typescript
interface Constraint {
  id?: string;
  description: string;     // e.g., "Tests must pass before deploy"
  type: "blocker" | "permission" | "pivot";
  embedding?: number[];
  createdAt: string;
}
```

**Constraint types map to Universal Logic Classes:**
- `blocker` - Something preventing progress (timeout, error, limitation)
- `permission` - Access or authorization requirement (auth, approval, role)
- `pivot` - A change in context that shifts the approach (urgency, user emotion, new info)

### Action
The move taken in response to the intent and constraints.

```typescript
interface Action {
  id?: string;
  description: string;     // e.g., "Ran CI/CD pipeline with rollback"
  outcome?: "success" | "failure" | "pending";
  embedding?: number[];
  createdAt: string;
}
```

### Justification
The "WHY" - the reasoning that connects intent, constraints, and action.

```typescript
interface Justification {
  description: string;     // e.g., "Deployed with rollback because staging had intermittent failures"
  confidence: number;      // 0-1, increases with successful validation
  ablationScore?: number;  // How critical this justification is (from ablation filter)
}
```

## Supporting Nodes

### ToolCall
Records individual tool invocations during a decision, enabling visualization and usage statistics.

```typescript
interface ToolCall {
  id?: string;
  name: string;          // e.g., "search_knowledge_base"
  args: string;          // Serialized tool arguments
  result?: string;       // Tool result (truncated for storage)
  durationMs?: number;   // Execution time in milliseconds
  createdAt: string;
}
```

### Agent
Represents an agent in a multi-agent system. Each agent is linked to a Project and optionally to one or more Domains.

```typescript
interface Agent {
  id?: string;
  name: string;           // e.g., "legal-agent"
  description?: string;   // e.g., "Reviews contracts and checks compliance"
  createdAt: string;
}
```

### Domain
A standalone node grouping traces and agents by domain. Domain is **not** stored as a property on traces — it exists only as a separate node connected via relationships.

```typescript
interface Domain {
  id?: string;
  name: string;           // e.g., "legal", "medical", "tech"
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
A semantic tag or label that links related decision traces across agents and domains.

```typescript
interface Concept {
  id?: string;
  name: string;           // e.g., "rate-limiting", "account-lockout"
  description?: string;
  embedding?: number[];   // For semantic concept search
  createdAt: string;
}
```

## Decision Trace

The complete record combining all components:

```typescript
interface DecisionTrace {
  id?: string;
  intent: Intent;
  constraints: Constraint[];
  action: Action;
  justification: Justification;
  toolCalls?: ToolCall[];    // Tool invocations captured during this decision
  project: string;
  tenant: string;
  domain?: string;           // Stored as relationship to Domain node
  agent?: string;            // Stored as relationship to Agent node
  concepts?: string[];       // Tag names linking similar traces
  status: TraceStatus;       // "captured" | "validated" | "synthesized" | "anti_pattern" | "pruned"
  embedding?: number[];      // Combined trace embedding for similarity search
  createdAt: string;
  updatedAt: string;
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

## Graph Representation

In the Graphmind database, the full graph structure is:

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
```

**Relationship summary:**

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

Vector indexes on `Intent(embedding)`, `DecisionTrace(embedding)`, and `Concept(embedding)` enable semantic similarity search via the SEARCH clause.
