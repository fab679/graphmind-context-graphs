export interface Intent {
  id?: string;
  description: string;
  embedding?: number[];
  createdAt: string;
}

export interface Constraint {
  id?: string;
  description: string;
  type: "blocker" | "permission" | "pivot";
  embedding?: number[];
  createdAt: string;
}

export interface Action {
  id?: string;
  description: string;
  outcome?: "success" | "failure" | "pending";
  embedding?: number[];
  createdAt: string;
}

export interface Justification {
  description: string;
  confidence: number;
  ablationScore?: number;
}

/** ToolCall node — records individual tool invocations for visualization/statistics. */
export interface ToolCall {
  id?: string;
  /** Tool name (e.g. "search_knowledge_base"). */
  name: string;
  /** Serialized arguments passed to the tool. */
  args: string;
  /** Tool result (truncated for storage). */
  result?: string;
  /** Duration in ms if available. */
  durationMs?: number;
  createdAt: string;
}

/** Agent node — represents an agent in a multi-agent system. */
export interface Agent {
  id?: string;
  /** Unique agent identifier within this project. */
  name: string;
  /** Human-readable description of the agent's role. */
  description?: string;
  createdAt: string;
}

/** First-class Domain node — groups traces and agents by domain. */
export interface Domain {
  id?: string;
  name: string;
  description?: string;
  createdAt: string;
}

/** First-class Project node — scopes all work within a tenant. */
export interface Project {
  id?: string;
  name: string;
  tenant: string;
  description?: string;
  createdAt: string;
}

/** Concept / Tag node — semantic label that links related decision traces. */
export interface Concept {
  id?: string;
  name: string;
  description?: string;
  embedding?: number[];
  createdAt: string;
}

/**
 * Skill node — a curated bundle of synthesized rules derived from decision traces.
 * Skills are auto-generated when related synthesized traces cluster around shared concepts.
 * Agents can discover and load skills on-demand (progressive disclosure).
 */
export interface Skill {
  id?: string;
  /** Unique skill name (derived from primary concept, e.g. "handle-locked-accounts"). */
  name: string;
  /** Human-readable description of what this skill covers. */
  description: string;
  /** The compiled prompt — combined rules from constituent traces. */
  prompt: string;
  /** Average confidence of constituent synthesized traces. */
  confidence: number;
  /** Concept names this skill was derived from. */
  concepts: string[];
  /** Tool names commonly used by this skill. */
  tools: string[];
  /** Number of synthesized traces backing this skill. */
  traceCount: number;
  /** Domain this skill belongs to (if all traces share one). */
  domain?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * Context sharing policy for multi-agent systems within a project.
 * - "shared": all agents in the project can read each other's traces (default)
 * - "isolated": agents only see their own traces
 * - "selective": agents can read traces from agents listed in `allowedAgents`
 */
export type ContextSharingPolicy = "shared" | "isolated" | "selective";

export interface DecisionTrace {
  id?: string;
  intent: Intent;
  constraints: Constraint[];
  action: Action;
  justification: Justification;
  /** Tool calls captured during this decision. */
  toolCalls?: ToolCall[];
  project: string;
  tenant: string;
  /** Domain name — stored as a relationship to a Domain node, not as a property. */
  domain?: string;
  /** Agent that produced this trace — stored as a relationship to an Agent node. */
  agent?: string;
  concepts?: string[];
  status: TraceStatus;
  embedding?: number[];
  createdAt: string;
  updatedAt: string;
}

export type TraceStatus =
  | "captured"
  | "validated"
  | "synthesized"
  | "anti_pattern"
  | "pruned";

export interface ScoredDecisionTrace {
  trace: DecisionTrace;
  similarity: number;
}

export interface FormattedContext {
  pastTraces: ScoredDecisionTrace[];
  rules: DecisionTrace[];
  antiPatterns: DecisionTrace[];
  /** Available skills (lightweight manifest for progressive disclosure). */
  skills: Skill[];
}
