import { GraphmindClient } from "graphmind-sdk";
import type {
  ResolvedContextGraphConfig,
} from "../types/config.js";
import {
  DEFAULT_METRIC,
  DEFAULT_VECTOR_SEARCH_LIMIT,
} from "../types/config.js";
import type {
  DecisionTrace,
  TraceStatus,
  ScoredDecisionTrace,
  Constraint,
  Intent,
  Action,
  Justification,
  ToolCall,
  Skill,
  ContextSharingPolicy,
} from "../types/data-model.js";
import type { LifecycleStats } from "../types/lifecycle.js";
import { createLogger, type Logger } from "../utils/logger.js";
import { buildGraphNamespace } from "../utils/namespace.js";
import { bootstrapSchema } from "./schema.js";
import {
  TRACE_QUERIES,
  PROJECT_QUERIES,
  DOMAIN_QUERIES,
  CONCEPT_QUERIES,
  AGENT_QUERIES,
  TOOLCALL_QUERIES,
  SKILL_QUERIES,
} from "./queries.js";
import { searchSimilarTraces, searchSimilarTracesByAgents } from "./vector.js";

export class GraphmindStore {
  private client: GraphmindClient;
  private graph: string;
  private project: string;
  private tenant: string;
  private agentName?: string;
  private contextSharing: ContextSharingPolicy;
  private allowedAgents?: string[];
  private logger: Logger;
  private config: ResolvedContextGraphConfig;

  constructor(config: ResolvedContextGraphConfig) {
    this.config = config;
    this.client = new GraphmindClient({
      url: config.graphmind.url,
      token: config.graphmind.token,
      username: config.graphmind.username,
      password: config.graphmind.password,
    });
    this.graph = buildGraphNamespace(config.tenant);
    this.project = config.project;
    this.tenant = config.tenant;
    this.agentName = config.agent;
    this.contextSharing = config.contextSharing ?? "shared";
    this.allowedAgents = config.allowedAgents;
    this.logger = createLogger(config.debug);
  }

  async initialize(): Promise<void> {
    const metric = this.config.embedding.metric ?? DEFAULT_METRIC;
    await bootstrapSchema(
      this.client,
      this.graph,
      this.config.embedding.dimensions,
      metric,
      this.logger
    );

    // Ensure the Project node exists
    await this.ensureProject();

    // Ensure the Agent node exists and is linked to the project
    if (this.agentName) {
      await this.ensureAgent(this.agentName, this.config.agentDescription);
    }
  }

  /** Create the Project node if it doesn't already exist. */
  async ensureProject(description?: string): Promise<void> {
    try {
      if (description) {
        await this.client.query(PROJECT_QUERIES.mergeProject, this.graph, {
          name: this.project,
          tenant: this.tenant,
          description,
          createdAt: new Date().toISOString(),
        });
      } else {
        await this.client.query(PROJECT_QUERIES.mergeProjectSimple, this.graph, {
          name: this.project,
          tenant: this.tenant,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      this.logger.debug("Project merge: %s", (err as Error).message);
    }
  }

  /** Create or retrieve a Domain node. */
  async ensureDomain(name: string, description?: string): Promise<void> {
    try {
      if (description) {
        await this.client.query(DOMAIN_QUERIES.mergeDomain, this.graph, {
          name,
          description,
          createdAt: new Date().toISOString(),
        });
      } else {
        await this.client.query(DOMAIN_QUERIES.mergeDomainSimple, this.graph, {
          name,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      this.logger.debug("Domain merge: %s", (err as Error).message);
    }
  }

  /** Create or retrieve an Agent node and link it to the current project. */
  async ensureAgent(name: string, description?: string): Promise<void> {
    try {
      if (description) {
        await this.client.query(AGENT_QUERIES.mergeAgent, this.graph, {
          name,
          description,
          createdAt: new Date().toISOString(),
        });
      } else {
        await this.client.query(AGENT_QUERIES.mergeAgentSimple, this.graph, {
          name,
          createdAt: new Date().toISOString(),
        });
      }
      // Link agent to project
      await this.client.query(AGENT_QUERIES.linkAgentToProject, this.graph, {
        agentName: name,
        project: this.project,
        tenant: this.tenant,
      });
    } catch (err) {
      this.logger.debug("Agent merge: %s", (err as Error).message);
    }
  }

  /** Link an agent to a domain. */
  async linkAgentToDomain(agentName: string, domain: string): Promise<void> {
    await this.ensureDomain(domain);
    try {
      await this.client.query(AGENT_QUERIES.linkAgentToDomain, this.graph, {
        agentName,
        domain,
      });
    } catch (err) {
      this.logger.debug("Agent-domain link: %s", (err as Error).message);
    }
  }

  /** Create or retrieve a Concept node. */
  async ensureConcept(
    name: string,
    description?: string,
    embedding?: number[]
  ): Promise<void> {
    try {
      if (description || embedding) {
        await this.client.query(CONCEPT_QUERIES.mergeConcept, this.graph, {
          name,
          description: description ?? "",
          embedding: embedding ?? [],
          createdAt: new Date().toISOString(),
        });
      } else {
        await this.client.query(CONCEPT_QUERIES.mergeConceptSimple, this.graph, {
          name,
          createdAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      this.logger.debug("Concept merge: %s", (err as Error).message);
    }
  }

  async saveDecisionTrace(
    trace: Omit<DecisionTrace, "id" | "createdAt" | "updatedAt">
  ): Promise<string> {
    const now = new Date().toISOString();

    // Ensure domain node exists if specified
    if (trace.domain) {
      await this.ensureDomain(trace.domain);
    }

    // Create trace + intent + action nodes (domain no longer a property)
    const result = await this.client.query(
      TRACE_QUERIES.createDecisionTrace,
      this.graph,
      {
        status: trace.status,
        justification_description: trace.justification.description,
        justification_confidence: trace.justification.confidence,
        justification_ablationScore:
          trace.justification.ablationScore ?? null,
        trace_embedding: trace.embedding ?? null,
        intent_description: trace.intent.description,
        intent_embedding: trace.intent.embedding ?? null,
        action_description: trace.action.description,
        action_outcome: trace.action.outcome ?? "pending",
        action_embedding: trace.action.embedding ?? null,
        createdAt: now,
        updatedAt: now,
      }
    );

    const traceId = result.records[0][0] as number;
    const traceIdStr = String(traceId);

    // Link trace → Project node
    try {
      await this.client.query(TRACE_QUERIES.linkTraceToProject, this.graph, {
        traceId,
        project: this.project,
        tenant: this.tenant,
      });
    } catch (err) {
      this.logger.warn("Failed to link trace to project: %s", (err as Error).message);
    }

    // Link trace → Domain node
    if (trace.domain) {
      try {
        await this.client.query(TRACE_QUERIES.linkTraceToDomain, this.graph, {
          traceId,
          domain: trace.domain,
        });
      } catch (err) {
        this.logger.warn("Failed to link trace to domain: %s", (err as Error).message);
      }
    }

    // Link trace → Agent node
    const agent = trace.agent ?? this.agentName;
    if (agent) {
      await this.ensureAgent(agent);
      try {
        await this.client.query(TRACE_QUERIES.linkTraceToAgent, this.graph, {
          traceId,
          agentName: agent,
        });
      } catch (err) {
        this.logger.warn("Failed to link trace to agent: %s", (err as Error).message);
      }

      // Also link agent to domain if both are specified
      if (trace.domain) {
        await this.linkAgentToDomain(agent, trace.domain);
      }
    }

    // Create constraint nodes
    for (const constraint of trace.constraints) {
      try {
        await this.client.query(
          TRACE_QUERIES.createConstraintForTrace,
          this.graph,
          {
            traceId,
            description: constraint.description,
            type: constraint.type,
            embedding: constraint.embedding ?? null,
            createdAt: now,
          }
        );
      } catch (err) {
        this.logger.warn("Failed to create constraint: %s", (err as Error).message);
      }
    }

    // Create ToolCall nodes
    if (trace.toolCalls && trace.toolCalls.length > 0) {
      for (const tc of trace.toolCalls) {
        try {
          await this.client.query(
            TOOLCALL_QUERIES.createToolCallForTrace,
            this.graph,
            {
              traceId,
              name: tc.name,
              args: tc.args,
              result: tc.result ?? null,
              durationMs: tc.durationMs ?? null,
              createdAt: now,
            }
          );
        } catch (err) {
          this.logger.warn("Failed to create tool call: %s", (err as Error).message);
        }
      }
    }

    // Tag trace with concepts
    if (trace.concepts && trace.concepts.length > 0) {
      for (const conceptName of trace.concepts) {
        await this.tagTraceWithConcept(traceIdStr, conceptName);
      }
    }

    this.logger.debug("Saved decision trace: %s", traceIdStr);
    return traceIdStr;
  }

  /** Tag a trace with a concept (creates concept node if needed). */
  async tagTraceWithConcept(
    traceId: string,
    conceptName: string,
    description?: string,
    embedding?: number[]
  ): Promise<void> {
    await this.ensureConcept(conceptName, description, embedding);
    try {
      await this.client.query(CONCEPT_QUERIES.linkTraceToConcept, this.graph, {
        traceId: Number(traceId),
        conceptName,
      });
    } catch (err) {
      this.logger.warn(
        "Failed to tag trace %s with concept '%s': %s",
        traceId,
        conceptName,
        (err as Error).message
      );
    }
  }

  /** Get all traces tagged with a concept. */
  async getTracesByConcept(conceptName: string): Promise<DecisionTrace[]> {
    const result = await this.client.queryReadonly(
      CONCEPT_QUERIES.getTracesByConcept,
      this.graph,
      { conceptName }
    );
    return (result.records || []).map((r: unknown[]) => reconstructTrace(r));
  }

  /** Get all concepts used within this project. */
  async getConceptsByProject(): Promise<
    { name: string; description?: string; traceCount: number }[]
  > {
    const result = await this.client.queryReadonly(
      CONCEPT_QUERIES.getConceptsByProject,
      this.graph,
      { project: this.project }
    );
    return (result.records || []).map((r: unknown[]) => ({
      name: String(r[0]),
      description: r[1] ? String(r[1]) : undefined,
      traceCount: Number(r[2]),
    }));
  }

  /** Get tool usage statistics for the project. */
  async getToolStats(): Promise<{ toolName: string; callCount: number }[]> {
    const result = await this.client.queryReadonly(
      TOOLCALL_QUERIES.getToolStatsByProject,
      this.graph,
      { project: this.project }
    );
    return (result.records || []).map((r: unknown[]) => ({
      toolName: String(r[0]),
      callCount: Number(r[1]),
    }));
  }

  /** Get tool usage statistics for a specific agent. */
  async getToolStatsByAgent(
    agentName: string
  ): Promise<{ toolName: string; callCount: number }[]> {
    const result = await this.client.queryReadonly(
      TOOLCALL_QUERIES.getToolStatsByAgent,
      this.graph,
      { agentName }
    );
    return (result.records || []).map((r: unknown[]) => ({
      toolName: String(r[0]),
      callCount: Number(r[1]),
    }));
  }

  /** Get all agents in this project. */
  async getAgentsByProject(): Promise<
    { name: string; description?: string }[]
  > {
    const result = await this.client.queryReadonly(
      AGENT_QUERIES.getAgentsByProject,
      this.graph,
      { project: this.project, tenant: this.tenant }
    );
    return (result.records || []).map((r: unknown[]) => ({
      name: String(r[0]),
      description: r[1] ? String(r[1]) : undefined,
    }));
  }

  async getTraceById(traceId: string): Promise<DecisionTrace | null> {
    const result = await this.client.queryReadonly(
      TRACE_QUERIES.getTraceById,
      this.graph,
      { traceId: Number(traceId) }
    );

    if (!result.records || result.records.length === 0) {
      return null;
    }

    return reconstructTraceExtended(result.records[0]);
  }

  /**
   * Find similar traces, respecting context sharing policy.
   * - "shared": searches all traces in the project
   * - "isolated": searches only this agent's traces
   * - "selective": searches traces from this agent + allowed agents
   */
  async findSimilarTraces(
    queryVector: number[],
    limit?: number
  ): Promise<ScoredDecisionTrace[]> {
    const topK = limit ?? this.config.vectorSearchLimit ?? DEFAULT_VECTOR_SEARCH_LIMIT;

    if (this.contextSharing === "isolated" && this.agentName) {
      return searchSimilarTracesByAgents(
        this.client,
        this.graph,
        queryVector,
        this.project,
        [this.agentName],
        topK,
        this.logger
      );
    }

    if (this.contextSharing === "selective" && this.agentName) {
      const agents = [this.agentName, ...(this.allowedAgents ?? [])];
      return searchSimilarTracesByAgents(
        this.client,
        this.graph,
        queryVector,
        this.project,
        agents,
        topK,
        this.logger
      );
    }

    // "shared" — search all traces in project
    return searchSimilarTraces(
      this.client,
      this.graph,
      queryVector,
      this.project,
      topK,
      this.logger
    );
  }

  async updateTraceStatus(
    traceId: string,
    status: TraceStatus
  ): Promise<void> {
    await this.client.query(TRACE_QUERIES.updateTraceStatus, this.graph, {
      traceId: Number(traceId),
      status,
      updatedAt: new Date().toISOString(),
    });
    this.logger.debug("Updated trace %s status to %s", traceId, status);
  }

  async updateTraceConfidence(
    traceId: string,
    confidence: number
  ): Promise<void> {
    await this.client.query(TRACE_QUERIES.updateTraceConfidence, this.graph, {
      traceId: Number(traceId),
      confidence,
      updatedAt: new Date().toISOString(),
    });
  }

  /** Atomically update both status and confidence on a trace. */
  async updateTraceStatusAndConfidence(
    traceId: string,
    status: TraceStatus,
    confidence: number
  ): Promise<void> {
    await this.client.query(TRACE_QUERIES.updateTraceStatusAndConfidence, this.graph, {
      traceId: Number(traceId),
      status,
      confidence,
      updatedAt: new Date().toISOString(),
    });
    this.logger.debug("Updated trace %s: status=%s, confidence=%s", traceId, status, confidence.toFixed(2));
  }

  async getActiveRules(): Promise<DecisionTrace[]> {
    const query =
      this.contextSharing === "isolated" && this.agentName
        ? TRACE_QUERIES.getActiveRulesByAgent
        : TRACE_QUERIES.getActiveRules;

    const params: Record<string, unknown> = { project: this.project };
    if (this.contextSharing === "isolated" && this.agentName) {
      params.agentName = this.agentName;
    }

    const result = await this.client.queryReadonly(query, this.graph, params);
    return (result.records || []).map((r: unknown[]) => reconstructTrace(r));
  }

  async getAntiPatterns(): Promise<DecisionTrace[]> {
    const query =
      this.contextSharing === "isolated" && this.agentName
        ? TRACE_QUERIES.getAntiPatternsByAgent
        : TRACE_QUERIES.getAntiPatterns;

    const params: Record<string, unknown> = { project: this.project };
    if (this.contextSharing === "isolated" && this.agentName) {
      params.agentName = this.agentName;
    }

    const result = await this.client.queryReadonly(query, this.graph, params);
    return (result.records || []).map((r: unknown[]) => reconstructTrace(r));
  }

  async countTraces(): Promise<number> {
    const result = await this.client.queryReadonly(
      TRACE_QUERIES.countTracesByProject,
      this.graph,
      { project: this.project }
    );
    return (result.records?.[0]?.[0] as number) ?? 0;
  }

  /** Get trace IDs by status (useful for batch validation). */
  async getTraceIdsByStatus(status: TraceStatus): Promise<string[]> {
    const result = await this.client.queryReadonly(
      TRACE_QUERIES.getTraceIdsByStatus,
      this.graph,
      { project: this.project, status }
    );
    return (result.records || []).map((r: unknown[]) => String(r[0]));
  }

  async getLifecycleStats(): Promise<LifecycleStats> {
    const result = await this.client.queryReadonly(
      TRACE_QUERIES.getLifecycleStats,
      this.graph,
      { project: this.project }
    );

    const stats: LifecycleStats = {
      captured: 0,
      validated: 0,
      synthesized: 0,
      antiPatterns: 0,
      pruned: 0,
      total: 0,
    };

    for (const record of result.records || []) {
      const status = record[0] as string;
      const count = record[1] as number;
      stats.total += count;
      switch (status) {
        case "captured":
          stats.captured = count;
          break;
        case "validated":
          stats.validated = count;
          break;
        case "synthesized":
          stats.synthesized = count;
          break;
        case "anti_pattern":
          stats.antiPatterns = count;
          break;
        case "pruned":
          stats.pruned = count;
          break;
      }
    }

    return stats;
  }

  async getCandidatesForSynthesis(
    minConfidence: number
  ): Promise<DecisionTrace[]> {
    const result = await this.client.queryReadonly(
      TRACE_QUERIES.getCandidatesForSynthesis,
      this.graph,
      { project: this.project, minConfidence }
    );
    return (result.records || []).map((r: unknown[]) => reconstructTrace(r));
  }

  async getCandidatesForPruning(
    maxConfidence: number
  ): Promise<string[]> {
    const result = await this.client.queryReadonly(
      TRACE_QUERIES.getCandidatesForPruning,
      this.graph,
      { project: this.project, maxConfidence }
    );
    return (result.records || []).map((r: unknown[]) => String(r[0]));
  }

  async createPrecedentLink(
    sourceId: string,
    targetId: string,
    similarity: number
  ): Promise<void> {
    await this.client.query(TRACE_QUERIES.createPrecedentLink, this.graph, {
      sourceId: Number(sourceId),
      targetId: Number(targetId),
      similarity,
    });
  }

  // ── Skill Methods ───────────────────────────────────────────────────────────

  /** Save or update a Skill node and link it to the project, concepts, and domain. */
  async saveSkill(skill: Omit<Skill, "id">): Promise<void> {
    try {
      await this.client.query(SKILL_QUERIES.mergeSkill, this.graph, {
        name: skill.name,
        description: skill.description,
        prompt: skill.prompt,
        confidence: skill.confidence,
        traceCount: skill.traceCount,
        createdAt: skill.createdAt,
        updatedAt: skill.updatedAt,
      });

      // Link to project
      await this.client.query(SKILL_QUERIES.linkSkillToProject, this.graph, {
        skillName: skill.name,
        project: this.project,
        tenant: this.tenant,
      });

      // Link to concepts
      for (const conceptName of skill.concepts) {
        await this.ensureConcept(conceptName);
        try {
          await this.client.query(SKILL_QUERIES.linkSkillToConcept, this.graph, {
            skillName: skill.name,
            conceptName,
          });
        } catch (err) {
          this.logger.debug("Skill-concept link: %s", (err as Error).message);
        }
      }

      // Link to domain
      if (skill.domain) {
        await this.ensureDomain(skill.domain);
        try {
          await this.client.query(SKILL_QUERIES.linkSkillToDomain, this.graph, {
            skillName: skill.name,
            domain: skill.domain,
          });
        } catch (err) {
          this.logger.debug("Skill-domain link: %s", (err as Error).message);
        }
      }
    } catch (err) {
      this.logger.warn("Failed to save skill '%s': %s", skill.name, (err as Error).message);
    }
  }

  /** Link a synthesized trace to a skill. */
  async linkTraceToSkill(traceId: string, skillName: string): Promise<void> {
    try {
      await this.client.query(SKILL_QUERIES.linkTraceToSkill, this.graph, {
        traceId: Number(traceId),
        skillName,
      });
    } catch (err) {
      this.logger.debug("Trace-skill link: %s", (err as Error).message);
    }
  }

  /** Get all skills for this project (lightweight manifest). */
  async getSkillsByProject(): Promise<Skill[]> {
    const result = await this.client.queryReadonly(
      SKILL_QUERIES.getSkillsByProject,
      this.graph,
      { project: this.project }
    );
    return (result.records || []).map((r: unknown[]) => reconstructSkill(r));
  }

  /** Get a skill by name with full details including tools. */
  async getSkillByName(name: string): Promise<Skill | null> {
    const result = await this.client.queryReadonly(
      SKILL_QUERIES.getSkillByName,
      this.graph,
      { name }
    );
    if (!result.records || result.records.length === 0) return null;
    return reconstructSkillWithTools(result.records[0]);
  }

  /** Get synthesized traces grouped by concept (for auto-skill synthesis). */
  async getSynthesizedTracesByConcept(): Promise<
    { concept: string; traces: { traceId: number; intent: string; action: string; justification: string; confidence: number; domain?: string; tools: string[] }[] }[]
  > {
    const result = await this.client.queryReadonly(
      SKILL_QUERIES.getSynthesizedTracesByConcept,
      this.graph,
      { project: this.project }
    );
    return (result.records || []).map((r: unknown[]) => ({
      concept: String(r[0]),
      traces: (r[1] as any[] || []).map((t: any) => ({
        traceId: Number(t.traceId ?? 0),
        intent: String(t.intent ?? ""),
        action: String(t.action ?? ""),
        justification: String(t.justification ?? ""),
        confidence: Number(t.confidence ?? 0),
        domain: t.domain ? String(t.domain) : undefined,
        tools: Array.isArray(t.tools) ? t.tools.map(String).filter(Boolean) : [],
      })),
    }));
  }

  getClient(): GraphmindClient {
    return this.client;
  }

  getGraphName(): string {
    return this.graph;
  }
}

/**
 * Reconstruct a DecisionTrace from a basic query result.
 * Columns: t, i, constraints, a
 */
export function reconstructTrace(record: unknown[]): DecisionTrace {
  const traceNode = record[0] as Record<string, unknown>;
  const intentNode = record[1] as Record<string, unknown> | null;
  const constraintNodes = record[2] as Record<string, unknown>[];
  const actionNode = record[3] as Record<string, unknown> | null;

  const traceProps = (traceNode as any)?.properties ?? traceNode ?? {};
  const intentProps = (intentNode as any)?.properties ?? intentNode ?? {};
  const actionProps = (actionNode as any)?.properties ?? actionNode ?? {};

  const constraints: Constraint[] = (constraintNodes || []).map((cn) => {
    const cp = (cn as any)?.properties ?? cn ?? {};
    return {
      id: String((cn as any)?.id ?? ""),
      description: String(cp.description ?? ""),
      type: (cp.type ?? "blocker") as Constraint["type"],
      embedding: cp.embedding as number[] | undefined,
      createdAt: String(cp.createdAt ?? ""),
    };
  });

  const intent: Intent = {
    id: String((intentNode as any)?.id ?? ""),
    description: String(intentProps.description ?? ""),
    embedding: intentProps.embedding as number[] | undefined,
    createdAt: String(intentProps.createdAt ?? ""),
  };

  const action: Action = {
    id: String((actionNode as any)?.id ?? ""),
    description: String(actionProps.description ?? ""),
    outcome: actionProps.outcome
      ? (String(actionProps.outcome) as Action["outcome"])
      : undefined,
    embedding: actionProps.embedding as number[] | undefined,
    createdAt: String(actionProps.createdAt ?? ""),
  };

  const justification: Justification = {
    description: String(traceProps.justification_description ?? ""),
    confidence: Number(traceProps.justification_confidence ?? 0),
    ablationScore: traceProps.justification_ablationScore
      ? Number(traceProps.justification_ablationScore)
      : undefined,
  };

  return {
    id: String((traceNode as any)?.id ?? ""),
    intent,
    constraints,
    action,
    justification,
    project: "",
    tenant: "",
    status: (traceProps.status ?? "captured") as DecisionTrace["status"],
    embedding: traceProps.embedding as number[] | undefined,
    createdAt: String(traceProps.createdAt ?? ""),
    updatedAt: String(traceProps.updatedAt ?? ""),
  };
}

/**
 * Reconstruct a DecisionTrace from an extended query result that includes
 * Project, Domain, Agent, Concept, and ToolCall nodes.
 * Columns: t, i, constraints, a, p, d, ag, concepts, toolCalls
 */
function reconstructTraceExtended(record: unknown[]): DecisionTrace {
  const base = reconstructTrace(record);

  const projectNode = record[4] as Record<string, unknown> | null;
  const domainNode = record[5] as Record<string, unknown> | null;
  const agentNode = record[6] as Record<string, unknown> | null;
  const conceptNodes = record[7] as Record<string, unknown>[] | null;
  const toolCallNodes = record[8] as Record<string, unknown>[] | null;

  const projectProps = (projectNode as any)?.properties ?? projectNode ?? {};
  const domainProps = (domainNode as any)?.properties ?? domainNode ?? {};
  const agentProps = (agentNode as any)?.properties ?? agentNode ?? {};

  base.project = projectProps.name ? String(projectProps.name) : "";
  base.tenant = projectProps.tenant ? String(projectProps.tenant) : "";
  base.domain = domainProps.name ? String(domainProps.name) : undefined;
  base.agent = agentProps.name ? String(agentProps.name) : undefined;

  if (conceptNodes && conceptNodes.length > 0) {
    base.concepts = conceptNodes.map((cn) => {
      const cp = (cn as any)?.properties ?? cn ?? {};
      return String(cp.name ?? "");
    }).filter(Boolean);
  }

  if (toolCallNodes && toolCallNodes.length > 0) {
    base.toolCalls = toolCallNodes.map((tn) => {
      const tp = (tn as any)?.properties ?? tn ?? {};
      return {
        id: String((tn as any)?.id ?? ""),
        name: String(tp.name ?? ""),
        args: String(tp.args ?? ""),
        result: tp.result ? String(tp.result) : undefined,
        durationMs: tp.durationMs ? Number(tp.durationMs) : undefined,
        createdAt: String(tp.createdAt ?? ""),
      };
    });
  }

  return base;
}

/**
 * Reconstruct a Skill from a query result.
 * Columns: s, concepts, domain
 */
function reconstructSkill(record: unknown[]): Skill {
  const skillNode = record[0] as Record<string, unknown>;
  const concepts = record[1] as string[] | null;
  const domain = record[2] as string | null;

  const sp = (skillNode as any)?.properties ?? skillNode ?? {};

  return {
    id: String((skillNode as any)?.id ?? ""),
    name: String(sp.name ?? ""),
    description: String(sp.description ?? ""),
    prompt: String(sp.prompt ?? ""),
    confidence: Number(sp.confidence ?? 0),
    concepts: (concepts || []).map(String).filter(Boolean),
    tools: [],
    traceCount: Number(sp.traceCount ?? 0),
    domain: domain ? String(domain) : undefined,
    createdAt: String(sp.createdAt ?? ""),
    updatedAt: String(sp.updatedAt ?? ""),
  };
}

/**
 * Reconstruct a Skill with tools from an extended query result.
 * Columns: s, concepts, domain, tools
 */
function reconstructSkillWithTools(record: unknown[]): Skill {
  const base = reconstructSkill(record);
  const tools = record[3] as string[] | null;
  base.tools = (tools || []).map(String).filter(Boolean);
  return base;
}
