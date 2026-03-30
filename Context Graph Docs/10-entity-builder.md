# Entity Builder (Dynamic Brain Mapping)

The Entity Builder is the key differentiator of Context Graphs. While the core triplet model (Intent -> Action -> Justification) captures decision traces automatically, the Entity Builder lets agents create **arbitrary domain entities** that are not known ahead of time -- building a brain map of their domain as they work.

## The Idea

A coding agent exploring a codebase should be able to note that `auth.ts` imports `crypto.ts`, that `UserController` handles the `/login` endpoint, and that a particular function has a bug. A legal agent should record that Contract #4521 is governed by GDPR Article 17. These are domain-specific facts that no predefined schema can anticipate.

The Entity Builder provides three tools for this:
- **`create_entity`** -- create arbitrary nodes (CodeFile, Contract, Symptom, etc.)
- **`create_relationship`** -- connect entities (IMPORTS, DEPENDS_ON, TREATS, etc.)
- **`find_entities`** -- search existing entities before creating duplicates

All three are included automatically in `contextGraph.tools`.

## create_entity

Create a new node in the context graph with any label and properties.

```typescript
// Agent calls create_entity with:
{
  label: "CodeFile",
  properties: {
    name: "auth.ts",
    path: "/src/auth.ts",
    language: "typescript",
    lineCount: 245
  },
  reason: "Core authentication module discovered during codebase exploration"
}
```

The tool:
- Creates a node with the given label and properties
- Adds a `_reason` property capturing **why** the entity was created
- Links the entity to the current Project and Agent automatically
- Returns the node ID for use in relationships

Labels should be **PascalCase** (e.g., `CodeFile`, `APIEndpoint`, `Contract`, `Symptom`).

## create_relationship

Connect two existing entities with a typed relationship.

```typescript
// Agent calls create_relationship with:
{
  source_id: "42",        // CodeFile: auth.ts
  target_id: "43",        // CodeFile: crypto.ts
  relationship_type: "IMPORTS",
  properties: {
    importType: "named"
  },
  reason: "auth.ts imports hash utilities from crypto.ts"
}
```

Relationship types should be **UPPER_SNAKE_CASE** (e.g., `IMPORTS`, `DEPENDS_ON`, `TREATS`, `GOVERNED_BY`).

The `properties` parameter is optional. A `_reason` property is always added to capture the rationale.

## find_entities

Search for existing entities by label and optional property filter. Use this before creating entities to avoid duplicates.

```typescript
// Agent calls find_entities with:
{
  label: "CodeFile",
  filter: { name: "auth.ts" }
}

// Response:
// Found 1 CodeFile entity:
// - id: 42 | name: auth.ts, path: /src/auth.ts, language: typescript
```

If no matches are found, the tool suggests using `create_entity` to add one.

## Every Entity Captures WHY

The `_reason` property is required on every `create_entity` call and added to every `create_relationship` call. This is intentional -- the context graph is not just a knowledge graph, it is a **decision graph**. Knowing *why* an entity was created is as important as the entity itself.

```
(CodeFile {name: "auth.ts", _reason: "Core authentication module discovered during codebase exploration"})
```

## Entities are Scoped

Every entity created through the tools is automatically linked to:
- The **Project** the agent is working in
- The **Agent** that created it (via `createdBy` metadata)

This means different projects maintain separate entity namespaces, and in multi-agent systems you can trace which agent discovered what.

## Domain Examples

### Coding Agent Mapping a Codebase

```
(CodeFile: auth.ts) --IMPORTS--> (CodeFile: crypto.ts)
(CodeFile: auth.ts) --EXPORTS--> (Function: validateToken)
(Function: validateToken) --HANDLES--> (ErrorType: TokenExpiredError)
(APIEndpoint: /api/login) --HANDLED_BY--> (Function: handleLogin)
(BugReport: #1234) --AFFECTS--> (Function: validateToken)
```

### Legal Agent Mapping Contracts

```
(Contract: MSA-4521) --CONTAINS--> (Clause: data-retention)
(Clause: data-retention) --GOVERNED_BY--> (Regulation: GDPR-Art-17)
(Contract: MSA-4521) --SIGNED_BY--> (Party: Acme Corp)
(Regulation: GDPR-Art-17) --REQUIRES--> (Obligation: right-to-erasure)
```

### Medical Agent Mapping Patient Data

```
(Patient: P-1001) --PRESENTS--> (Symptom: chronic-fatigue)
(Symptom: chronic-fatigue) --INDICATES--> (Condition: hypothyroidism)
(Condition: hypothyroidism) --TREATED_WITH--> (Medication: levothyroxine)
(Medication: levothyroxine) --INTERACTS_WITH--> (Medication: warfarin)
```

## Best Practices

1. **Use `inspect_schema` first** -- Before creating entities, check what labels and relationship types already exist. Reuse existing types whenever possible.

2. **PascalCase labels** -- `CodeFile`, not `code_file` or `codeFile`. This is enforced by convention, not by the tool.

3. **UPPER_SNAKE_CASE relationships** -- `DEPENDS_ON`, not `dependsOn` or `depends-on`.

4. **Use `find_entities` before creating** -- Always search for existing entities to avoid duplicates. If a `CodeFile` with `name: "auth.ts"` already exists, reference it by ID instead of creating a new one.

5. **Write meaningful reasons** -- The `_reason` field is your future self's documentation. "Found during exploration" is less useful than "Core authentication module that handles JWT validation and session management".

6. **Keep properties flat** -- Properties are key-value pairs with string, number, or boolean values. For complex nested data, use relationships to other entities instead.

## Setup

The entity builder tools are included automatically when you create a context graph:

```typescript
import { createContextGraph } from "graphmind-context-graphs";

const contextGraph = await createContextGraph({
  tenant: "acme_corp",
  project: "backend-api",
  agent: "coding-agent",
  embedding: { provider, dimensions: 1536 },
});

// contextGraph.tools includes:
// - inspect_schema
// - query_graph
// - create_entity
// - create_relationship
// - find_entities

const agent = createAgent({
  model: "claude-sonnet-4-6",
  tools: [...codingTools, ...contextGraph.tools],
  middleware: contextGraph.middleware,
});
```

The agent will naturally use these tools as it works, building up a domain-specific knowledge graph that persists across sessions and can be queried by other agents in the same project.
