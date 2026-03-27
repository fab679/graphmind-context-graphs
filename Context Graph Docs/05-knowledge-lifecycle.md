# Knowledge Lifecycle

The Knowledge Lifecycle Manager implements the evolutionary distillation process: transforming raw decision traces into institutional wisdom.

## The Four Stages

### 1. Capture
Raw decision traces are recorded by the Reasoning Extractor with status `captured` and initial confidence based on ablation scoring.

### 2. Validate
External feedback (user, automated tests, outcome observation) marks traces as successful or failed.

```typescript
// Mark a trace as successful
await contextGraph.lifecycle.validateTrace("trace-id", {
  traceId: "trace-id",
  success: true,
  feedback: "Deployment succeeded without issues",
});

// Mark a trace as failed
await contextGraph.lifecycle.validateTrace("trace-id", {
  traceId: "trace-id",
  success: false,
  feedback: "Caused a regression in production",
});
```

**Confidence adjustment:**
- Success: `confidence += 0.1` (capped at 1.0)
- Failure: `confidence -= 0.15` (floored at 0.0)

### 3. Synthesize
Traces with consistently high confidence are promoted to permanent rules.

```typescript
const promotedIds = await contextGraph.lifecycle.synthesizeRules({
  minSuccessCount: 3,  // Default: 3
});
```

Promoted traces:
- Status changes to `synthesized`
- Appear in the "Established Rules" section of injected prompts
- Have higher priority than raw traces

### 4. Prune
Traces with consistently low confidence are marked as anti-patterns.

```typescript
const prunedIds = await contextGraph.lifecycle.pruneFailures({
  minFailureCount: 2,  // Default: 2
});
```

Pruned traces:
- Status changes to `anti_pattern`
- Appear in the "Anti-Patterns to Avoid" section of injected prompts
- Warn agents away from repeating failed approaches

## Monitoring

Track the lifecycle distribution of your knowledge base:

```typescript
const stats = await contextGraph.lifecycle.getLifecycleStats();
console.log(stats);
// {
//   captured: 45,
//   validated: 20,
//   synthesized: 8,
//   antiPatterns: 3,
//   pruned: 0,
//   total: 76
// }
```

## Automation

For production use, consider running synthesis and pruning on a schedule:

```typescript
// Run periodically (e.g., daily cron job)
async function evolveKnowledge() {
  const promoted = await contextGraph.lifecycle.synthesizeRules();
  const pruned = await contextGraph.lifecycle.pruneFailures();
  console.log(`Promoted ${promoted.length} rules, pruned ${pruned.length} anti-patterns`);
}
```
