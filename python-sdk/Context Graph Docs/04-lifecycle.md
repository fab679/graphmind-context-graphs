# Knowledge Lifecycle — Python SDK

Decision traces evolve through stages based on validation feedback:

```
CAPTURED (0.5) → VALIDATED (±confidence) → SYNTHESIZED (rule)
                                         ↘ ANTI_PATTERN (pruned)
```

## Validation

After the agent resolves an issue, validate the outcome. Each validation adjusts the trace's confidence score:

```python
from graphmind_context_graphs import ValidationResult

# Success → confidence +0.1 (capped at 1.0)
cg.lifecycle.validate_trace("42", ValidationResult(
    trace_id="42",
    success=True,
    feedback="Issue resolved successfully",
))

# Failure → confidence -0.15 (floored at 0.0)
cg.lifecycle.validate_trace("42", ValidationResult(
    trace_id="42",
    success=False,
    feedback="Solution did not work",
))
```

Validation changes the trace status from `captured` to `validated` and updates its confidence.

## Synthesis

Promote high-confidence validated traces to permanent rules:

```python
# Traces with confidence >= 0.7 become rules (status → "synthesized")
promoted = cg.lifecycle.synthesize_rules(min_confidence=0.7)
print(f"Promoted {len(promoted)} traces to rules")
```

Rules are injected into every agent prompt under "Established Rules" by the prompt injector.

## Pruning

Mark low-confidence traces as anti-patterns:

```python
# Validated traces with confidence <= 0.2 become anti-patterns
pruned = cg.lifecycle.prune_failures(max_confidence=0.2)
print(f"Pruned {len(pruned)} traces as anti-patterns")
```

Anti-patterns appear in the prompt under "Anti-Patterns to Avoid" with "AVOID:" prefix.

## Monitoring

```python
stats = cg.lifecycle.get_lifecycle_stats()
print(f"Captured: {stats.captured}")
print(f"Validated: {stats.validated}")
print(f"Synthesized: {stats.synthesized}")
print(f"Anti-patterns: {stats.anti_patterns}")
print(f"Pruned: {stats.pruned}")
print(f"Total: {stats.total}")
```

You can also query specific traces:

```python
# Get all trace IDs in a given status
captured_ids = cg.store.get_trace_ids_by_status("captured")

# Get a specific trace
trace = cg.store.get_trace_by_id("42")
if trace:
    print(f"Intent: {trace.intent.description}")
    print(f"Action: {trace.action.description}")
    print(f"Confidence: {trace.justification.confidence}")
    print(f"Concepts: {trace.concepts}")
```

## Full Lifecycle Example

```python
from graphmind_context_graphs import (
    create_context_graph, ContextGraphConfig, EmbeddingConfig, ValidationResult,
)

cg = create_context_graph(ContextGraphConfig(
    tenant="acme", project="support",
    agent="support-agent",
    embedding=EmbeddingConfig(provider=my_embeddings, dimensions=1536),
))

# ... agent runs and captures traces ...

# 1. Review captured traces
stats = cg.lifecycle.get_lifecycle_stats()
print(f"New traces to review: {stats.captured}")

# 2. Validate based on outcomes
captured = cg.store.get_trace_ids_by_status("captured")
for trace_id in captured:
    trace = cg.store.get_trace_by_id(trace_id)
    # Your logic to determine success/failure
    was_successful = check_outcome(trace)
    cg.lifecycle.validate_trace(trace_id, ValidationResult(
        trace_id=trace_id,
        success=was_successful,
        feedback="Resolved" if was_successful else "Did not resolve",
    ))

# 3. Promote high-confidence patterns to rules
promoted = cg.lifecycle.synthesize_rules(min_confidence=0.7)
print(f"New rules: {len(promoted)}")

# 4. Prune consistently failing approaches
pruned = cg.lifecycle.prune_failures(max_confidence=0.2)
print(f"New anti-patterns: {len(pruned)}")

# 5. Check final state
stats = cg.lifecycle.get_lifecycle_stats()
print(f"Rules: {stats.synthesized}, Anti-patterns: {stats.anti_patterns}")
```

## Automation

Run lifecycle evolution on a schedule:

```python
import schedule

def evolve_knowledge():
    captured = cg.store.get_trace_ids_by_status("captured")
    for trace_id in captured:
        outcome = check_outcome(trace_id)  # Your logic
        cg.lifecycle.validate_trace(trace_id, outcome)

    cg.lifecycle.synthesize_rules()
    cg.lifecycle.prune_failures()

schedule.every(1).hour.do(evolve_knowledge)
```

## Additional Store Methods

The `cg.store` provides additional query methods useful for monitoring:

```python
# Tool usage stats
tool_stats = cg.store.get_tool_stats()
for t in tool_stats:
    print(f"  {t['tool_name']}: {t['call_count']} calls")

# Concepts discovered
concepts = cg.store.get_concepts_by_project()
for c in concepts:
    print(f"  #{c['name']}: {c['trace_count']} traces")

# Agents in this project
agents = cg.store.get_agents_by_project()
for a in agents:
    print(f"  {a['name']}: {a['description']}")
```
