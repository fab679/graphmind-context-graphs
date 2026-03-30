# Tool Call Tracking

The Context Graph captures tool invocations from LangChain message history and stores them as `Tool` nodes linked to decision traces via `USED_TOOL` relationships. This enables usage analytics, debugging, and feeds tool data into skill synthesis.

## How It Works

When the Reasoning Extractor saves a decision trace, it scans the agent's message history for tool calls and their results:

1. AI messages contain `tool_calls` (name, args, call ID)
2. Tool messages contain results (matched by call ID)
3. Each unique tool name gets a reusable `Tool` node (merged, not duplicated)
4. The trace is linked to each tool via a `USED_TOOL` relationship

```
(DecisionTrace) --USED_TOOL--> (Tool {name: "search_knowledge_base"})
(DecisionTrace) --USED_TOOL--> (Tool {name: "check_account_status"})
```

## ToolCall Interface

```typescript
interface ToolCall {
  id?: string;
  name: string;        // Tool name (e.g., "search_knowledge_base")
  args: string;        // JSON-serialized arguments
  result?: string;     // Tool result (truncated to 500 chars)
  durationMs?: number; // Execution time in ms (if available)
  createdAt: string;   // ISO timestamp
}
```

## Tool Statistics

### Project-Wide

```typescript
const toolStats = await contextGraph.store.getToolStats();
// [
//   { toolName: "search_knowledge_base", callCount: 15 },
//   { toolName: "check_account_status", callCount: 8 },
//   { toolName: "escalate_to_human", callCount: 2 },
// ]
```

### Per-Agent

```typescript
const agentStats = await contextGraph.store.getToolStatsByAgent("support-agent");
// [
//   { toolName: "search_knowledge_base", callCount: 10 },
//   { toolName: "check_account_status", callCount: 5 },
// ]
```

## Tool Data in Skills

When the lifecycle manager synthesizes Skills from clustered traces, it collects all unique tool names used across the constituent traces and includes them in the Skill:

```typescript
const skills = await contextGraph.lifecycle.synthesizeSkills();

const skill = await contextGraph.store.getSkillByName("handle-account-lockout");
console.log(skill.tools);
// ["check_account_status", "search_knowledge_base", "reset_password"]
```

These tools appear in the Skill's SKILL.md output as `allowed-tools`, making them compatible with the Agent Skills specification:

```yaml
---
name: handle-account-lockout
allowed-tools: check_account_status, search_knowledge_base, reset_password
---
```

## Use Cases

- **Debugging** -- See which tools influenced a particular decision trace
- **Optimization** -- Identify underused or overused tools across agents
- **Auditing** -- Track tool usage for compliance and governance
- **Skill quality** -- Understand which tools are associated with high-confidence patterns
