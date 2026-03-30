# Skills (Progressive Disclosure)

Skills are curated bundles of validated decision patterns that agents can discover and load on-demand. They implement **progressive disclosure** -- keeping the context window lean until the agent needs specialized knowledge.

## How Skills Work

```
Synthesized Traces             Auto-Synthesis              Agent Discovery
┌─────────────────┐           ┌───────────┐              ┌──────────────────┐
│ Trace A (#acct)  │──cluster──▶│  Skill:   │──manifest──▶│ System prompt:   │
│ Trace B (#acct)  │  by       │  handle-  │  injected   │ "Available skills│
│ Trace C (#acct)  │  concept  │  account- │             │  - handle-acct.."│
└─────────────────┘           │  lockout  │             │                  │
                              └───────────┘             │ load_skill tool  │
                                                        │ for full context │
                                                        └──────────────────┘
```

The full lifecycle: **traces -> validated -> synthesized -> skill**.

1. **Synthesis** -- When 2+ synthesized traces share a concept tag, the lifecycle manager clusters them into a Skill
2. **Manifest** -- The prompt injector adds a lightweight skill listing to the system prompt (name + description only)
3. **On-Demand Loading** -- The agent calls `load_skill` to fetch the full skill prompt when needed

## Auto-Skill Synthesis

Skills are created by `KnowledgeLifecycleManager.synthesizeSkills()`:

```typescript
// After synthesizeRules() promotes traces, synthesize skills
const skillNames = await contextGraph.lifecycle.synthesizeSkills();
// ["handle-account-lockout", "handle-rate-limiting"]
```

For each concept with >= 2 synthesized traces (configurable via `minTraces` argument), a Skill is created:
- **Name** derived from the concept: `"account-lockout"` -> `"handle-account-lockout"`
- **Prompt** compiled from the combined intent/action/justification of constituent traces
- **Confidence** = average confidence of constituent traces
- **Tools** = unique tool names used across constituent traces (see [07-tool-calls.md](./07-tool-calls.md))
- **Domain** = shared domain if all traces belong to the same one

### Skill Node in the Graph

```
(Skill {name, description, prompt, confidence, traceCount})
  -[:BELONGS_TO_PROJECT]-> (Project)
  -[:DERIVED_FROM_CONCEPT]-> (Concept)
  -[:BELONGS_TO_DOMAIN]-> (Domain)

(DecisionTrace) -[:CONTRIBUTES_TO]-> (Skill)
```

## Using Skills with Agents

### 1. Automatic Manifest Injection

When skills exist, the prompt injector automatically adds a manifest to the system prompt:

```
## Skills System
You have access to specialized skills derived from validated decision patterns.
When a user's request matches a skill below, use `load_skill` with the skill name.

- **handle-account-lockout** [support]: Handles account-lockout scenarios
  based on 5 validated decision patterns (tools: check_account_status)
- **handle-rate-limiting** [tech]: Handles rate-limiting scenarios
  based on 3 validated decision patterns
```

### 2. Progressive Disclosure Tools

Add skill tools to your agent for on-demand loading:

```typescript
import {
  createContextGraph,
  createSkillTool,
  createListSkillsTool,
} from "graphmind-context-graphs";

const contextGraph = await createContextGraph({
  tenant: "my_company",
  project: "support",
  agent: "support-agent",
  embedding: { provider, dimensions: 1536 },
});

const loadSkill = createSkillTool(contextGraph.store);
const listSkills = createListSkillsTool(contextGraph.store);

const agent = createAgent({
  model: "claude-sonnet-4-6",
  tools: [searchKB, checkAccount, loadSkill, listSkills],
  middleware: contextGraph.middleware,
});
```

**`load_skill`** -- Load a skill by name or URL. Returns SKILL.md format content.
- Pass a skill name (e.g., `"handle-account-lockout"`) to load from the graph
- Pass a URL to fetch a remote SKILL.md file

**`list_skills`** -- List all available skills with names, descriptions, confidence, and concept tags.

### 3. Agent Flow

1. Agent receives user query
2. System prompt includes the skill manifest (lightweight, no full prompts)
3. Agent sees `handle-account-lockout` skill matches the query
4. Agent calls `load_skill("handle-account-lockout")`
5. Tool returns the full skill prompt with validated decision patterns
6. Agent uses the skill context to make an informed decision

## SKILL.md Format

Skills follow the [Agent Skills specification](https://agentskills.io/specification). When `load_skill` is called, it returns content in this format:

```markdown
---
name: handle-account-lockout
description: Handles account-lockout scenarios based on 3 validated decision patterns.
allowed-tools: check_account_status, search_knowledge_base
metadata:
  domain: support
  confidence: "0.85"
  trace-count: "3"
---

# handle-account-lockout

## Overview

Handles account-lockout scenarios based on 3 validated decision patterns.

## Instructions

When handling "account-lockout" scenarios, follow these validated decision patterns:

1. **Intent**: User can't log in, account locked
   **Action**: Check failed attempts, offer password reset
   **Why**: Account locks after 5 failed attempts

## Tags

- #account-lockout
```

### Exporting Skills to Filesystem

Export graph-synthesized skills as SKILL.md files for use with any Agent Skills-compatible framework:

```typescript
import { formatSkillAsMarkdown } from "graphmind-context-graphs";
import { writeFile, mkdir } from "fs/promises";

const skills = await contextGraph.store.getSkillsByProject();
for (const skill of skills) {
  const full = await contextGraph.store.getSkillByName(skill.name);
  if (!full) continue;
  const dir = `./skills/${skill.name}`;
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/SKILL.md`, formatSkillAsMarkdown(full));
}
```

## Skill Interface

```typescript
interface Skill {
  id?: string;
  name: string;           // e.g., "handle-account-lockout"
  description: string;    // Human-readable summary
  prompt: string;         // The full skill context/rules
  confidence: number;     // Average confidence of constituent traces
  concepts: string[];     // Concept tags this skill covers
  tools: string[];        // Tool names commonly used
  traceCount: number;     // Number of backing traces
  domain?: string;        // Domain if all traces share one
  createdAt: string;
  updatedAt: string;
}
```

## Full Lifecycle Example

```typescript
// 1. Agent handles many account lockout scenarios over time...
//    (traces are captured automatically by the middleware)

// 2. Validate successful outcomes
await contextGraph.lifecycle.validateTrace(traceId, {
  traceId,
  success: true,
});

// 3. Promote validated traces with confidence >= 0.7 to rules
await contextGraph.lifecycle.synthesizeRules();

// 4. Auto-create skills from clustered rules sharing concepts
const skills = await contextGraph.lifecycle.synthesizeSkills();
// ["handle-account-lockout"]

// 5. On next agent run, skill manifest is injected automatically
// 6. Agent calls load_skill("handle-account-lockout") for full context
```
