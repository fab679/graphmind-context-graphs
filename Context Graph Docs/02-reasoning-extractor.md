# Reasoning Extractor

The Reasoning Extractor is LangChain middleware that silently observes agent behavior and captures decision traces. It answers the question: **what reasoning led to this action?**

## How It Works

The extractor uses LangChain's `createMiddleware()` API with two hooks that wrap the agent's model and tool calls without altering their behavior.

```typescript
import { createReasoningExtractor } from "graphmind-context-graphs";

const extractor = createReasoningExtractor(config, registry, observerModel);

const agent = createAgent({
  model: "openai:gpt-4.1",
  tools: [...],
  middleware: [extractor],
});
```

### `wrapModelCall`

Intercepts every model response. When the agent produces a final response (no tool calls), the extractor:

1. Collects reasoning facts from the full message history
2. Extracts structured ToolCall nodes from tool invocations
3. Runs structured extraction (LLM or heuristic fallback)
4. Applies ablation filtering to keep only critical facts
5. Saves the complete decision trace via the registry

### `wrapToolCall`

Passes tool calls through transparently. Tool results are captured in the next model call via message history -- the extractor does not modify tool behavior.

## Fact Extraction

Facts are gathered from the agent's message history:

- **AI messages**: Reasoning sentences are split and filtered (sentences > 10 chars, up to 5 per message)
- **Tool call intents**: Recorded as `Used tool "name" with args: {...}`
- **Tool results**: Recorded as `Observation: {result}` (truncated to 500 chars)

## LLM-Powered Structured Extraction

When an **observer model** is provided, the extractor uses it to perform structured extraction via a dedicated prompt. The observer LLM analyzes the agent's intent, decision, and critical facts, then returns structured JSON:

```json
{
  "domain": "software-engineering",
  "concepts": ["api-authentication", "rate-limiting"],
  "constraints": [
    { "description": "API key expired", "type": "blocker" },
    { "description": "Fallback endpoint available", "type": "permission" }
  ],
  "entities": [
    { "label": "APIEndpoint", "name": "/v2/auth/token" }
  ]
}
```

What the observer extracts:

| Field | Purpose |
|-------|---------|
| `domain` | Specific domain classification (e.g., "software-engineering" not just "tech") |
| `concepts` | 1-5 semantic tags for future retrieval |
| `constraints` | Facts classified as blocker, permission, or pivot |
| `entities` | Domain-specific entities discovered (PascalCase labels) |

The observer model should be fast and cheap -- it runs on every decision trace. A smaller model (e.g., GPT-4o-mini) works well here.

## Heuristic Fallback

When no observer model is configured, the extractor falls back to pattern-based extraction:

**Constraint classification** uses keyword matching:

| Classification | Keywords |
|---------------|----------|
| `blocker` | cannot, error, fail, block, timeout, denied |
| `permission` | allow, permit, access, grant, auth |
| `pivot` | Everything else |

**Concept extraction** uses regex patterns against the combined text:

| Pattern | Tag |
|---------|-----|
| account lock/block/suspend | `account-lockout` |
| rate limit, 429 | `rate-limiting` |
| deploy, release | `deployment` |
| contract, clause, compliance | `compliance` |
| diagnosis, symptom, treatment | `clinical-decision` |

**Domain inference** checks for domain-specific keywords:

| Domain | Keywords |
|--------|----------|
| `tech` | api, endpoint, sdk, rate limit |
| `finance` | billing, payment, invoice |
| `support` | account, login, password |
| `legal` | compliance, regulation, contract |
| `medical` | patient, diagnosis, treatment |
| `general` | Everything else |

The heuristic fallback ensures the middleware works without any LLM overhead, at the cost of extraction quality.

## Ablation Filtering

When an observer model is available and the project is **not** in discovery mode, the extractor runs ablation filtering on extracted facts. This determines which facts are **critical** to the decision:

1. Each fact is evaluated for its causal contribution to the decision
2. Facts scored as non-critical are dropped
3. The average confidence of remaining facts becomes the `ablationScore`

This prevents the context graph from filling up with noise. Only facts that actually influenced the decision are stored.

## Discovery Mode

When no prior traces exist for the project (cold start), the extractor enters **discovery mode**:

- All facts are captured without ablation filtering
- Initial confidence is set to `0.5` (baseline)
- This ensures the first decisions build a foundation for future comparisons

Discovery mode is automatically detected by the registry and deactivates once the first trace is recorded.

## Agent Attribution

When an `agent` name is configured, it is included in every saved trace, creating a `PRODUCED_BY` relationship. This enables:

- Per-agent trace filtering
- Context sharing policies (`shared`, `isolated`, `selective`)
- Multi-agent visualization and debugging

## ToolCall Capture

In addition to fact extraction, the extractor captures structured **ToolCall** nodes from the message history. Each tool invocation is stored as a graph node linked to the trace via `USED_TOOL`, enabling:

- Tool usage visualization in the graph
- Per-agent and per-project tool usage statistics
- Understanding which tools drive which decisions

Tool results are matched back to their invocations via `tool_call_id` and truncated to 500 characters for storage.
