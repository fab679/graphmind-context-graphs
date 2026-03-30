# Agent Tools — Python SDK

`create_context_graph()` returns 5 tools in `cg.tools` that agents use for brain mapping and graph exploration. These are LangChain `@tool` functions that the agent can call during conversations.

## Setup

```python
cg = create_context_graph(config)

agent = create_agent(
    "openai:gpt-4.1",
    tools=[*my_tools, *cg.tools],  # 5 context graph tools added
    middleware=cg.middleware,
)
```

The 5 tools: `inspect_schema`, `query_graph`, `create_entity`, `create_relationship`, `find_entities`.

## Schema & Exploration

### `inspect_schema`

Shows the agent its own entity types and relationships. Agent-scoped when an agent name is configured — only shows entities this agent created. Framework types (DecisionTrace, Intent, Action, etc.) are filtered out — only domain entities are shown.

```python
# Agent calls:
inspect_schema()

# Returns:
# # Your Context Graph Schema
# ## Entity Types (Node Labels)
# - **CodeFile**: 5 node(s)
# - **DesignDecision**: 2 node(s)
# ## Relationship Types
# - **GOVERNED_BY**: 2 edge(s)
# - **DEPENDS_ON**: 3 edge(s)
# ## Guidelines
# - Check if a similar entity type already exists before creating new ones.
# - Entity labels: PascalCase (e.g., `CodeFile`, `APIEndpoint`).
# - Relationship types: UPPER_SNAKE_CASE (e.g., `DEPENDS_ON`, `IMPORTS`).
```

When the graph is empty:
```
The context graph is empty — no entities or relationships exist yet.
You are in discovery mode. Use `create_entity` and `create_relationship` to build your understanding.
```

### `query_graph`

Freeform read-only Cypher queries for exploring the graph. Takes a `query` (Cypher MATCH...RETURN) and `description` (what it's looking for).

```python
# Agent calls:
query_graph(
    query="MATCH (f:CodeFile)-[:DEPENDS_ON]->(d:CodeFile) RETURN f.name, d.name",
    description="Find file dependencies"
)

# Returns:
# Results (3 rows):
# f.name: auth.ts | d.name: session.ts
# f.name: login.ts | d.name: auth.ts
# f.name: login.ts | d.name: rate-limiter.ts
```

Only read-only queries — no CREATE/DELETE/SET allowed.

## Brain Mapping

### `create_entity`

Create domain-specific entities. Uses `extra="allow"` on the Pydantic schema — any named argument becomes a property on the node.

```python
# Agent calls:
create_entity(label="CodeFile", path="src/auth/login.ts", purpose="Login with rate limiting")
# Returns: Entity created: CodeFile (id: 42). Properties: {"path": "src/auth/login.ts", ...}

create_entity(label="DesignDecision", decision="Rate limiting added after brute-force incident")
create_entity(label="Contract", name="DataCorp Agreement", value=500000)
```

Each entity is automatically:
- Linked to the current project via `BELONGS_TO_PROJECT`
- Linked to the creating agent via `CREATED_BY` (if agent is configured)
- Given a `name` property (auto-generated from the first string property if not provided)

### `create_relationship`

Connect entities with typed relationships. Relationship types should be UPPER_SNAKE_CASE.

```python
# Agent calls:
create_relationship(
    source_id="42",
    target_id="43",
    relationship_type="DEPENDS_ON",
    reason="login.ts imports session.ts"
)
# Returns: Relationship created: (42)-[:DEPENDS_ON]->(43).
```

### `find_entities`

Search existing entities before creating duplicates. Returns up to 50 results ordered by creation date.

```python
# Agent calls:
find_entities(label="CodeFile")
# Returns:
# Found 3 CodeFile entities:
# - id: 42 | path: src/auth/login.ts, name: src/auth/login.ts
# - id: 43 | path: src/auth/session.ts, name: src/auth/session.ts
# - id: 44 | path: src/utils/rate-limiter.ts, name: src/utils/rate-limiter.ts

# With property filter:
find_entities(label="CodeFile", filter={"path": "src/auth/login.ts"})
# Returns:
# Found 1 CodeFile entity:
# - id: 42 | path: src/auth/login.ts, name: src/auth/login.ts
```

## Skill Tools (Optional)

Skill tools are not included in `cg.tools` by default. Add them separately for progressive disclosure:

```python
from graphmind_context_graphs import create_skill_tool, create_list_skills_tool

agent = create_agent(
    "openai:gpt-4.1",
    tools=[
        *my_tools,
        *cg.tools,
        create_skill_tool(cg.store),       # load_skill — load a skill by name or URL
        create_list_skills_tool(cg.store),  # list_skills — list all available skills
    ],
    middleware=cg.middleware,
)
```

### `load_skill`

Loads a skill by name (from the graph) or by URL (fetches a SKILL.md file). Returns the skill as formatted markdown with frontmatter, instructions, and concept tags.

### `list_skills`

Lists all skills in the current project with confidence scores, trace counts, domain, and concept tags.
