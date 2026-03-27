# Skills (Progressive Disclosure)

Skills are curated bundles of validated decision patterns that agents can discover and load on-demand. Inspired by LangChain's [Skills architecture](https://docs.langchain.com/), they implement **progressive disclosure** — keeping the context window lean until the agent needs specialized knowledge.

## How Skills Work

```
Synthesized Traces              Auto-Synthesis               Agent Discovery
┌─────────────────┐            ┌───────────┐               ┌──────────────────┐
│ Trace A (#acct)  │──cluster──▶│  Skill:   │──manifest──▶ │ System prompt:    │
│ Trace B (#acct)  │  by       │  handle-  │  injected    │ "Available skills │
│ Trace C (#acct)  │  concept  │  account- │              │  - handle-acct..."│
└─────────────────┘            │  lockout  │              │                  │
                               └───────────┘              │ load_skill tool  │
                                                          │ for full context │
                                                          └──────────────────┘
```

1. **Synthesis** — When multiple synthesized traces share a concept tag, the lifecycle manager clusters them into a Skill
2. **Manifest** — The prompt injector injects a lightweight skill listing (name + description only)
3. **On-Demand Loading** — The agent uses the `load_skill` tool to fetch the full skill prompt when needed

## Auto-Skill Synthesis

Skills are automatically created by the `KnowledgeLifecycleManager` when synthesized traces cluster around shared concepts:

```typescript
// After synthesizeRules() promotes traces, synthesize skills
const skillNames = await contextGraph.lifecycle.synthesizeSkills();
// ["handle-account-lockout", "handle-rate-limiting"]
```

For each concept with 2+ synthesized traces, a Skill is created:
- **Name** derived from the concept: `"account-lockout"` → `"handle-account-lockout"`
- **Prompt** compiled from the combined rules of constituent traces
- **Confidence** = average confidence of constituent traces
- **Tools** = unique tool names used across constituent traces
- **Domain** = shared domain (if all traces belong to the same one)

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
## Available Skills
The following specialized skills are available. Use the `load_skill` tool
to load a skill's full context when it matches the current task.

- **handle-account-lockout** [support]: Handles account-lockout scenarios
  based on 5 validated decision patterns (#account-lockout)
- **handle-rate-limiting** [tech]: Handles rate-limiting scenarios
  based on 3 validated decision patterns (#rate-limiting)
```

### 2. Progressive Disclosure Tools

Add the skill tools to your agent for on-demand loading:

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

// Create skill tools
const loadSkill = createSkillTool(contextGraph.store);
const listSkills = createListSkillsTool(contextGraph.store);

// Add to agent alongside your domain tools
const agent = createAgent({
  model: "openai:gpt-4.1",
  tools: [searchKB, checkAccount, loadSkill, listSkills],
  middleware: contextGraph.middleware,
});
```

### 3. Agent Flow

1. Agent receives user query
2. System prompt includes skill manifest (lightweight)
3. Agent sees `handle-account-lockout` skill matches the query
4. Agent calls `load_skill("handle-account-lockout")`
5. Tool returns the full skill prompt with validated decision patterns
6. Agent uses the skill context to make an informed decision

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

## Querying Skills

```typescript
// Get all skills in the project
const skills = await contextGraph.store.getSkillsByProject();

// Get a specific skill with full details
const skill = await contextGraph.store.getSkillByName("handle-account-lockout");
```

## Full Lifecycle Example

```typescript
// 1. Agent handles many account lockout scenarios...
// 2. Validate successful outcomes
await contextGraph.lifecycle.validateTrace(traceId, {
  traceId, success: true
});

// 3. Promote validated traces to rules
await contextGraph.lifecycle.synthesizeRules();

// 4. Auto-create skills from clustered rules
const skills = await contextGraph.lifecycle.synthesizeSkills();
// ["handle-account-lockout"]

// 5. On next agent run, skill manifest is injected automatically
// 6. Agent can load_skill("handle-account-lockout") for full context
```
