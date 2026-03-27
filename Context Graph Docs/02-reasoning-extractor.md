# Reasoning Extractor (The Auditor)

The Reasoning Extractor is a LangChain middleware that observes agent behavior and captures decision traces, including tool call records.

## How It Works

The extractor uses LangChain's `createMiddleware()` API with two hooks:

### `wrapModelCall`
Intercepts model responses to capture reasoning and detect when the agent finishes.

- Extracts facts from AI message content (sentences that describe observations or reasoning)
- Records tool call intents (what tools the agent decided to use and why)
- Captures **ToolCall nodes** from the message history (tool name, args, result)
- When the agent produces a final response (no tool calls), triggers trace saving

### `wrapToolCall`
Captures tool execution results as factual observations.

## Fact Extraction

Facts are extracted from the agent's message history:

1. **AI messages** - Reasoning sentences are split and filtered (>10 chars)
2. **Tool calls** - Recorded as `Used tool "name" with args: {...}`
3. **Tool results** - Recorded as `Observation: {result}` (truncated to 500 chars)

## ToolCall Capture

In addition to facts, the extractor captures structured **ToolCall nodes** from the message history. Each tool invocation is stored as a graph node linked to the trace via `USED_TOOL`, enabling:

- Tool usage visualization in the graph
- Per-agent and per-project tool usage statistics
- Understanding which tools drive which decisions

## Fact Classification

Each extracted fact is automatically classified into a Universal Logic Class:

| Classification | Keywords |
|---------------|----------|
| `blocker` | cannot, error, fail, block, timeout, denied |
| `permission` | allow, permit, access, grant, auth |
| `pivot` | Everything else (context changes, decisions) |

## Concept Auto-Extraction

The extractor automatically tags traces with semantic concepts based on pattern matching:

| Pattern | Concept Tag |
|---------|-------------|
| account lock/block/suspend | `account-lockout` |
| password reset/change/forgot | `password-reset` |
| rate limit, 429 | `rate-limiting` |
| billing, payment, refund | `billing` |
| diagnos, symptom, treatment | `clinical-decision` |
| contract, clause, compliance | `compliance` |
| liability, negligence | `legal-risk` |
| prescription, dosage | `medication` |

## Domain Inference

If no explicit domain is configured, the extractor infers it from the content:

| Domain | Keywords |
|--------|----------|
| `tech` | api, endpoint, sdk, rate limit, 429 |
| `finance` | billing, payment, invoice, refund |
| `support` | account, login, password, auth |
| `legal` | legal, compliance, regulation, contract, liability |
| `medical` | medical, patient, diagnosis, treatment, prescription |
| `general` | Everything else |

## Agent Attribution

When an `agent` name is configured, the extractor includes it in the saved trace. This creates a `PRODUCED_BY` relationship to the Agent node, enabling:

- Per-agent trace filtering
- Context sharing policies (shared, isolated, selective)
- Multi-agent visualization

## Discovery Mode

When no prior traces exist for the project (cold start), the extractor enters **Discovery Mode**:
- All facts are captured without ablation filtering
- Initial confidence is set to 0.5
- This ensures the first decisions create a baseline for future comparisons

## Integration

```typescript
import { createReasoningExtractor } from "graphmind-context-graphs";

const extractor = createReasoningExtractor(config, registry, observerModel);

// Used as middleware in createAgent()
const agent = createAgent({
  model: "openai:gpt-4.1",
  tools: [...],
  middleware: [extractor],
});
```
