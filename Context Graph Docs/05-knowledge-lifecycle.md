# Knowledge Lifecycle

The `KnowledgeLifecycleManager` implements a 4-stage evolution pipeline that transforms raw decision traces into institutional wisdom. Traces move through **Capture -> Validate -> Synthesize -> Prune**, with confidence scores governing promotion and demotion.

## The Four Stages

```
  Capture         Validate          Synthesize         Prune
  (0.5)       (+0.1 / -0.15)       (>= 0.7)          (<= 0.2)
┌─────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ captured │──▶│  validated   │──▶│ synthesized  │   │ anti_pattern │
│          │   │              │   │  (rules)     │   │  (warnings)  │
└─────────┘   └──────┬───────┘   └──────────────┘   └──────────────┘
                     │                                     ▲
                     └─── confidence <= 0.2 ───────────────┘
```

### 1. Capture

The Reasoning Extractor automatically records raw traces with status `captured`. In **discovery mode** (fewer than a threshold of existing traces), initial confidence is set to **0.5**. When an observer model is configured, the ablation filter scores each trace and that score becomes its initial confidence instead.

No code is needed -- capture happens automatically via the middleware.

### 2. Validate

External feedback adjusts a trace's confidence score. Call `validateTrace()` with a `ValidationResult` to record whether a decision led to a good or bad outcome.

```typescript
// Successful outcome -- confidence increases by 0.1 (capped at 1.0)
await contextGraph.lifecycle.validateTrace("42", {
  traceId: "42",
  success: true,
  feedback: "Deployment succeeded without issues",
});

// Failed outcome -- confidence decreases by 0.15 (floored at 0.0)
await contextGraph.lifecycle.validateTrace("42", {
  traceId: "42",
  success: false,
  feedback: "Caused a regression in production",
});
```

The asymmetry (success: +0.1, failure: -0.15) is intentional. Failures weigh more heavily because bad patterns should be demoted faster than good ones are promoted.

Status is atomically updated to `validated` alongside the new confidence.

### 3. Synthesize

Validated traces with confidence >= **0.7** are promoted to permanent rules.

```typescript
const promotedIds = await contextGraph.lifecycle.synthesizeRules();
// ["42", "78", "103"]
```

Promoted traces:
- Status changes to `synthesized`
- Appear in the **"Established Rules"** section of injected system prompts
- Have higher weight than raw `captured` traces

You can pass options to customize the minimum success count:

```typescript
const promotedIds = await contextGraph.lifecycle.synthesizeRules({
  minSuccessCount: 5,  // default: 3
});
```

### 4. Prune

Validated traces with confidence <= **0.2** are marked as anti-patterns.

```typescript
const prunedIds = await contextGraph.lifecycle.pruneFailures();
// ["17", "91"]
```

Pruned traces:
- Status changes to `anti_pattern`
- Appear in the **"Anti-Patterns to Avoid"** section of injected system prompts
- Warn agents away from repeating failed approaches

## Skill Synthesis

After synthesizing rules, the lifecycle manager can auto-create **Skills** from clustered synthesized traces that share concept tags. See [08-skills.md](./08-skills.md) for full details.

```typescript
// Step 1: Promote validated traces to rules
await contextGraph.lifecycle.synthesizeRules();

// Step 2: Cluster synthesized traces by concept and create Skills
const skillNames = await contextGraph.lifecycle.synthesizeSkills();
// ["handle-account-lockout", "handle-rate-limiting"]
```

For each concept with >= 2 synthesized traces (configurable via `minTraces` argument), a Skill node is created with:
- Name derived from the concept (e.g., `"account-lockout"` becomes `"handle-account-lockout"`)
- Prompt compiled from the combined intent/action/justification of constituent traces
- Confidence = average confidence of constituent traces
- Tools = unique tool names used across constituent traces

## Monitoring

Track the lifecycle distribution with `getLifecycleStats()`:

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

The `LifecycleStats` interface:

```typescript
interface LifecycleStats {
  captured: number;
  validated: number;
  synthesized: number;
  antiPatterns: number;
  pruned: number;
  total: number;
}
```

## Automation

For production use, run synthesis and pruning on a schedule:

```typescript
async function evolveKnowledge() {
  // Promote high-confidence traces to rules
  const promoted = await contextGraph.lifecycle.synthesizeRules();
  // Demote low-confidence traces to anti-patterns
  const pruned = await contextGraph.lifecycle.pruneFailures();
  // Auto-create skills from clustered rules
  const skills = await contextGraph.lifecycle.synthesizeSkills();

  console.log(
    `Promoted ${promoted.length} rules, pruned ${pruned.length} anti-patterns, synthesized ${skills.length} skills`
  );
}
```

## API Reference

| Method | Description |
|--------|-------------|
| `validateTrace(traceId, result)` | Record outcome feedback, adjusting confidence |
| `synthesizeRules(options?)` | Promote validated traces with confidence >= 0.7 |
| `pruneFailures(options?)` | Mark validated traces with confidence <= 0.2 as anti-patterns |
| `synthesizeSkills(minTraces?)` | Auto-create Skills from clustered synthesized traces |
| `getLifecycleStats()` | Get counts by lifecycle stage |
