# Middleware — Python SDK

The Context Graph uses two LangChain middleware components that hook into `create_agent()`.

## Prompt Injector (`@dynamic_prompt`)

Runs **before every model call**. Queries the graph for relevant context and injects it as a dynamic system prompt.

Uses LangChain's `@dynamic_prompt` decorator, which receives a `ModelRequest` and returns a system prompt string.

```python
from graphmind_context_graphs.core.prompt_injector import create_prompt_injector

injector = create_prompt_injector(registry, config)
```

### What Gets Injected

Each section only appears when relevant content exists:

1. **Your Brain Map** — entity types and relationships the agent has created (filtered to domain entities only — framework types like `DecisionTrace`, `Agent`, etc. are excluded)
2. **Relevant Past Logic** — similar decision traces found via vector search, with similarity scores, domain tags, and concept tags
3. **Established Rules** — synthesized high-confidence patterns that should be followed
4. **Anti-Patterns** — approaches that consistently failed, marked with "AVOID"
5. **Skills Manifest** — available skill bundles for progressive disclosure

### Example Injected Prompt

```
## Your Brain Map (Context Graph Schema)
These are the entity types and relationships you have created or produced.

**Entity Types:**
  - CodeFile (10 nodes)
  - APIEndpoint (3 nodes)

**Relationship Types:**
  - IMPORTS (15 edges)
  - CALLS (7 edges)

## Relevant Past Logic (Director's Commentary)
The following past decisions are relevant to the current task.

- **Intent**: Fix the login bug (similarity: 0.88) [tech] tags: #authentication, #sso
  **Action**: Patched auth middleware
  **Why**: SSO flow was bypassing token refresh
  **Constraints**:
  - [blocker] Must not break SSO

## Established Rules
These patterns have been validated multiple times and should be followed:

- Always check token expiry before auth flow (confidence: 0.90)

## Anti-Patterns to Avoid
These approaches have been tried and consistently failed:

- AVOID: Caching auth tokens without expiry check (reason: led to failure)
```

## Reasoning Extractor (`AgentMiddleware`)

Subclasses LangChain's `AgentMiddleware` and overrides `wrap_model_call`. Runs on **every model call** — but only captures a trace when the agent's final response has no tool calls (i.e., the agent is finishing its turn).

The extractor reads the `AIMessage` from the `ModelResponse.result` list returned by the handler.

```python
from graphmind_context_graphs.core.reasoning_extractor import ReasoningExtractorMiddleware

extractor = ReasoningExtractorMiddleware(config, registry, observer_model)
```

### What Gets Captured

| Field | Source |
|---|---|
| **Intent** | First user (human) message in the conversation |
| **Action** | The agent's final response text (truncated to 500 chars) |
| **Constraints** | Reasoning facts classified as blocker/permission/pivot |
| **Justification** | Summary of critical facts, or tool usage + intent |
| **Tool Calls** | Every tool invocation with name, args, and result |
| **Concepts** | Semantic tags (LLM-extracted or heuristic pattern matching) |
| **Domain** | Configured domain, or auto-inferred from keywords |

### LLM vs Heuristic Extraction

With an `observer_model` configured, the extractor uses a second LLM to do structured extraction of domain, concepts, and constraints:

```python
cg = create_context_graph(ContextGraphConfig(
    observer_model="openai:gpt-4.1-mini",  # Enables LLM extraction
    ...
))
```

Without it, fallback heuristics are used:
- **Domain**: keyword matching (e.g., "api" → tech, "billing" → finance, "account" → support)
- **Concepts**: regex patterns (e.g., "rate limit" → rate-limiting, "password reset" → password-reset)
- **Constraints**: classified by keyword (e.g., "error"/"timeout" → blocker, "allow"/"grant" → permission)

## Using in an Agent

Both middleware are returned by `create_context_graph()` and passed directly to `create_agent()`:

```python
cg = create_context_graph(config)

agent = create_agent(
    "openai:gpt-4.1",
    tools=[*my_tools, *cg.tools],
    middleware=cg.middleware,  # [prompt_injector, reasoning_extractor]
)

# First conversation — trace captured
result = agent.invoke({
    "messages": [{"role": "user", "content": "My account is locked"}]
})

# Second conversation — past trace injected into system prompt
result = agent.invoke({
    "messages": [{"role": "user", "content": "I can't sign in, getting errors"}]
})
```

### Embeddings

When a trace is captured, the reasoning extractor calls the registry's `record_decision()`, which auto-generates embeddings for:
- The full trace text (intent + constraints + action + justification)
- The intent description
- The action description
- Each constraint description
- Each concept name

These embeddings power the vector search that the prompt injector uses to find relevant past traces.
