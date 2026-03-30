# Prompt Injector

The Prompt Injector dynamically enriches agent system prompts with contextual "Director's Commentary" from the context graph. It is the bridge between stored decision traces and the agent's working memory.

## How It Works

Implemented as a `dynamicSystemPromptMiddleware`, it runs **before every model call**:

1. Extracts the last user message from the conversation
2. Queries the Contextual Registry for relevant context (vector search + rules + anti-patterns + skills + schema)
3. Formats each category into a prompt section
4. Assembles the sections and prepends them to the base system prompt

```typescript
import { createPromptInjector } from "graphmind-context-graphs";

const injector = createPromptInjector(registry, config);

const agent = createAgent({
  model: "openai:gpt-4.1",
  tools: [...],
  middleware: [injector, extractor],
});
```

## Injected Sections

Each section only appears when relevant content exists. If the graph is empty or nothing matches, the agent gets just the base system prompt with no clutter.

### 1. Your Brain Map (Agent-Scoped Schema)

Shows the agent what entity types and relationships **it has created or produced**. The schema is scoped to the agent -- other agents' entities are not visible. This prevents confusion and ensures the brain map guides only the agent that owns the context.

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

In a multi-agent system, each agent sees only its own schema. Decision traces still flow across agents via sharing policies, but the brain map stays agent-local.

### 2. Relevant Past Logic

Similar past decisions retrieved via vector search, with similarity scores. These are reference points, not strict rules.

```
## Relevant Past Logic (Director's Commentary)
The following past decisions are relevant to the current task. Use them as reference, not as strict rules.

- **Intent**: Deploy to production (similarity: 0.89) [devops] tags: #deployment
  **Action taken**: Ran CI pipeline with rollback enabled
  **Why**: Tests passed but staging had intermittent failures
  **Constraints**:
    - [blocker] Staging environment had 3 timeout errors
    - [permission] Deploy approval from team lead required
```

### 3. Established Rules

Synthesized traces that have been validated multiple times. These have high confidence and represent proven patterns.

```
## Established Rules
These patterns have been validated multiple times and should be followed:

- Always run integration tests before deploy (confidence: 0.95) [#deployment]
- Use retry with exponential backoff for API timeouts (confidence: 0.88) [#performance]
```

### 4. Anti-Patterns to Avoid

Traces marked as failures. These are approaches that have been tried and consistently produced bad outcomes.

```
## Anti-Patterns to Avoid
These approaches have been tried and consistently failed:

- AVOID: Deploying without code review (reason: led to failure)
- AVOID: Ignoring flaky tests in staging (reason: led to failure)
```

### 5. Skills System

A progressive disclosure manifest of available skills. Each skill is a curated bundle of rules derived from synthesized traces. The agent sees a summary and can load full instructions on demand via the `load_skill` tool.

```
## Skills System
You have access to specialized skills derived from validated decision patterns.
When a user's request matches a skill below, use `load_skill` with the skill name to load its full instructions before proceeding.

- **handle-locked-accounts** [support]: Resolve account lockout issues (tools: check_account_status, unlock_account)
- **api-rate-limit-recovery** [tech]: Handle rate limiting and 429 errors (tools: check_rate_limits)
```

## Graceful Degradation

If the registry call fails for any reason (database unavailable, embedding service down, timeout), the injector catches the error, logs a warning, and falls back to the base system prompt. The agent continues working without context enrichment rather than crashing.

```typescript
try {
  const context = await registry.getRelevantContext(userContent);
  // ... build sections
} catch (err) {
  logger.warn("Failed to inject context: %s", err.message);
  return config.baseSystemPrompt ?? "";
}
```

## Configuration

The `baseSystemPrompt` config option provides the foundation that context sections are appended to.

```typescript
const contextGraph = await createContextGraph({
  project: "my-project",
  tenant: "my-tenant",
  baseSystemPrompt: "You are a helpful coding assistant.",
  // ...
});
```

If `baseSystemPrompt` is not set, only the injected context sections are used. If no context exists either, the agent gets an empty system prompt.

## Section Assembly

Sections are joined with double newlines. The order is intentional:

1. **Base system prompt** -- the agent's identity and instructions
2. **Schema** -- what the agent knows about (prevents ambiguity)
3. **Past traces** -- similar situations (provides context)
4. **Rules** -- validated patterns (provides guidance)
5. **Anti-patterns** -- known failures (provides guardrails)
6. **Skills** -- available capabilities (provides tools)

This ordering ensures the agent reads its core instructions first, then gets progressively more specific context.
