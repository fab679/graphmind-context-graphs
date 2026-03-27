# Tool Call Tracking

The Context Graph captures individual tool invocations as `ToolCall` nodes in the graph, enabling visualization and usage analytics.

## How It Works

When the Reasoning Extractor saves a decision trace, it also extracts all tool calls from the agent's message history and creates `ToolCall` nodes linked to the trace via `USED_TOOL`.

```
(DecisionTrace) --USED_TOOL--> (ToolCall {name: "search_knowledge_base", args: '{"query": "..."}', result: "..."})
(DecisionTrace) --USED_TOOL--> (ToolCall {name: "check_account_status", args: '{"email": "..."}', result: "..."})
```

## ToolCall Properties

| Property | Type | Description |
|----------|------|-------------|
| `name` | string | Tool name (e.g., `"search_knowledge_base"`) |
| `args` | string | JSON-serialized arguments passed to the tool |
| `result` | string | Tool result (truncated to 500 chars for storage) |
| `durationMs` | number | Execution time in milliseconds (if available) |
| `createdAt` | string | ISO timestamp |

## Querying Tool Statistics

### Project-Wide Stats

```typescript
const toolStats = await contextGraph.store.getToolStats();
// [
//   { toolName: "search_knowledge_base", callCount: 15 },
//   { toolName: "check_account_status", callCount: 8 },
//   { toolName: "escalate_to_human", callCount: 2 },
// ]
```

### Per-Agent Stats

```typescript
const agentStats = await contextGraph.store.getToolStatsByAgent("support-agent");
// [
//   { toolName: "search_knowledge_base", callCount: 10 },
//   { toolName: "check_account_status", callCount: 5 },
// ]
```

## Visualization

ToolCall nodes are first-class graph entities. In the Graphmind visualizer, you can see:
- Which tools each trace used
- How frequently each tool is called
- Which agents use which tools
- Tool call patterns across domains

This is useful for:
- **Debugging** — understanding which tools influenced a decision
- **Optimization** — identifying underused or overused tools
- **Auditing** — tracking tool usage for compliance
