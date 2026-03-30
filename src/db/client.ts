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
  Skill,
  ContextSharingPolicy,
  GraphEntity,
  GraphRelationship,
  SchemaOverview,
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
  TOOL_QUERIES,
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
      const query = description ? PROJECT_QUERIES.mergeProject : PROJECT_QUERIES.mergeProjectSimple;
      const params: Record<string, unknown> = {
        name: this.project, tenant: this.tenant, createdAt: new Date().toISOString(),
      };
      if (description) params.description = description;
      await this.client.query(query, this.graph, params);
    } catch (err) {
      this.logger.warn("Project ensure failed: %s", (err as Error).message);
    }
  }

  /** Create or retrieve a Domain node. */
  async ensureDomain(name: string, description?: string): Promise<void> {
    try {
      const query = description ? DOMAIN_QUERIES.mergeDomain : DOMAIN_QUERIES.mergeDomainSimple;
      const params: Record<string, unknown> = { name, createdAt: new Date().toISOString() };
      if (description) params.description = description;
      await this.client.query(query, this.graph, params);
    } catch (err) {
      this.logger.warn("Domain ensure failed: %s", (err as Error).message);
    }
  }

  /** Create or retrieve an Agent node and link it to the current project. */
  async ensureAgent(name: string, description?: string): Promise<void> {
    try {
      const query = description ? AGENT_QUERIES.mergeAgent : AGENT_QUERIES.mergeAgentSimple;
      const params: Record<string, unknown> = { name, createdAt: new Date().toISOString() };
      if (description) params.description = description;
      await this.client.query(query, this.graph, params);
      await this.client.query(AGENT_QUERIES.linkAgentToProject, this.graph, {
        agentName: name, project: this.project, tenant: this.tenant,
      });
    } catch (err) {
      this.logger.warn("Agent ensure failed: %s", (err as Error).message);
    }
  }

  /** Link an agent to a domain. */
  async linkAgentToDomain(agentName: string, domain: string): Promise<void> {
    await this.ensureDomain(domain);
    try {
      await this.client.query(AGENT_QUERIES.linkAgentToDomain, this.graph, { agentName, domain });
    } catch (err) {
      this.logger.debug("Agent-domain link: %s", (err as Error).message);
    }
  }

  /** Create or retrieve a Tool node (one per unique tool name). */
  async ensureTool(name: string): Promise<void> {
    try {
      await this.client.query(TOOL_QUERIES.mergeTool, this.graph, {
        name, createdAt: new Date().toISOString(),
      });
    } catch (err) {
      this.logger.warn("Tool ensure failed: %s", (err as Error).message);
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
          name, description: description ?? "", embedding: embedding ?? [], createdAt: new Date().toISOString(),
        });
      } else {
        await this.client.query(CONCEPT_QUERIES.mergeConceptSimple, this.graph, {
          name, createdAt: new Date().toISOString(),
        });
      }
      // Update embedding on existing concept if provided
      if (embedding) {
        await this.client.query(CONCEPT_QUERIES.updateConceptEmbedding, this.graph, {
          name, embedding,
        });
      }
    } catch (err) {
      this.logger.warn("Concept ensure failed: %s", (err as Error).message);
    }
  }

  async saveDecisionTrace(
    trace: Omit<DecisionTrace, "id" | "createdAt" | "updatedAt">
  ): Promise<string> {
    const now = new Date().toISOString();

    // Create trace + intent + action nodes with name properties for visualization
    const result = await this.client.query(
      TRACE_QUERIES.createDecisionTrace,
      this.graph,
      {
        trace_name: truncateName(`${trace.intent.description} → ${trace.action.description}`),
        status: trace.status,
        justification_description: trace.justification.description,
        justification_confidence: trace.justification.confidence,
        justification_ablationScore:
          trace.justification.ablationScore ?? null,
        trace_embedding: trace.embedding ?? null,
        intent_name: truncateName(trace.intent.description),
        intent_description: trace.intent.description,
        intent_embedding: trace.intent.embedding ?? null,
        action_name: truncateName(trace.action.description),
        action_description: trace.action.description,
        action_outcome: trace.action.outcome ?? "pending",
        action_embedding: trace.action.embedding ?? null,
        createdAt: now,
        updatedAt: now,
      }
    );

    const traceId = result.records[0][0] as number;
    const traceIdStr = String(traceId);

    // Link trace → Project (ensure exists first via MERGE, then MATCH+CREATE)
    try {
      await this.ensureProject();
      await this.client.query(TRACE_QUERIES.linkTraceToProject, this.graph, {
        traceId, project: this.project, tenant: this.tenant,
      });
    } catch (err) {
      this.logger.warn("Failed to link trace to project: %s", (err as Error).message);
    }

    // Link trace → Domain
    if (trace.domain) {
      try {
        await this.ensureDomain(trace.domain);
        await this.client.query(TRACE_QUERIES.linkTraceToDomain, this.graph, {
          traceId, domain: trace.domain,
        });
      } catch (err) {
        this.logger.warn("Failed to link trace to domain: %s", (err as Error).message);
      }
    }

    // Link trace → Agent
    const agent = trace.agent ?? this.agentName;
    if (agent) {
      try {
        await this.ensureAgent(agent);
        await this.client.query(TRACE_QUERIES.linkTraceToAgent, this.graph, {
          traceId, agentName: agent,
        });
      } catch (err) {
        this.logger.warn("Failed to link trace to agent: %s", (err as Error).message);
      }

      if (trace.domain) {
        await this.linkAgentToDomain(agent, trace.domain);
      }
    }

    // Create constraint nodes
    for (const constraint of trace.constraints) {
      try {
        await this.client.query(TRACE_QUERIES.createConstraintForTrace, this.graph, {
          traceId,
          name: truncateName(constraint.description),
          description: constraint.description,
          type: constraint.type,
          embedding: constraint.embedding ?? null,
          createdAt: now,
        });
      } catch (err) {
        this.logger.warn("Failed to create constraint: %s", (err as Error).message);
      }
    }

    // Link tool usages (ensure Tool exists first, then link)
    if (trace.toolCalls && trace.toolCalls.length > 0) {
      for (const tc of trace.toolCalls) {
        try {
          await this.ensureTool(tc.name);
          await this.client.query(TOOL_QUERIES.linkTraceToTool, this.graph, {
            traceId, toolName: tc.name,
          });
        } catch (err) {
          this.logger.warn("Failed to link tool usage: %s", (err as Error).message);
        }
      }
    }

    // Tag trace with concepts (ensure Concept exists first, then link)
    if (trace.concepts && trace.concepts.length > 0) {
      for (const conceptName of trace.concepts) {
        await this.tagTraceWithConcept(traceIdStr, conceptName);
      }
    }

    this.logger.debug("Saved decision trace: %s", traceIdStr);
    return traceIdStr;
  }

  /** Tag a trace with a concept (ensures concept node exists first, then links). */
  async tagTraceWithConcept(
    traceId: string,
    conceptName: string,
    description?: string,
    embedding?: number[]
  ): Promise<void> {
    // Always ensure concept exists before linking
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
      TOOL_QUERIES.getToolStatsByProject,
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
      TOOL_QUERIES.getToolStatsByAgent,
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

      // Link to project (MERGE = idempotent)
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
      SKILL_QUERIES.getSynthesizedTracesWithConcepts,
      this.graph,
      { project: this.project }
    );

    // Group flat rows by concept in JavaScript (avoids nested collect in Cypher)
    const groups = new Map<string, { traceId: number; intent: string; action: string; justification: string; confidence: number; domain?: string; tools: string[] }[]>();

    for (const r of result.records || []) {
      const concept = String(r[0]);
      const trace = {
        traceId: Number(r[1] ?? 0),
        intent: String(r[2] ?? ""),
        action: String(r[3] ?? ""),
        justification: String(r[4] ?? ""),
        confidence: Number(r[5] ?? 0),
        domain: r[6] ? String(r[6]) : undefined,
        tools: [] as string[],
      };

      if (!groups.has(concept)) {
        groups.set(concept, []);
      }
      // Deduplicate by traceId within each concept group
      const existing = groups.get(concept)!;
      if (!existing.some((t) => t.traceId === trace.traceId)) {
        existing.push(trace);
      }
    }

    return Array.from(groups.entries())
      .map(([concept, traces]) => ({ concept, traces }))
      .sort((a, b) => b.traces.length - a.traces.length);
  }

  // ── Schema Introspection ─────────────────────────────────────────────────────

  /**
   * Get a schema overview scoped to this agent's context.
   *
   * Only returns entity types and relationships that this agent has created or
   * produced. This ensures the schema injected into the system prompt guides
   * only the agent that owns the context — other agents' entities are not leaked.
   *
   * Scope:
   * - Nodes connected via CREATED_BY (dynamic entities this agent built)
   * - Nodes connected via PRODUCED_BY (decision traces this agent captured)
   * - Nodes reachable from this agent's traces (Intent, Constraint, Action, Concept, etc.)
   *
   * If no agent name is configured, falls back to project-scoped schema.
   */
  async getSchemaOverview(): Promise<SchemaOverview> {
    try {
      if (this.agentName) {
        return await this.getAgentScopedSchema(this.agentName);
      }
      // No agent configured — show project-scoped schema
      return await this.getProjectScopedSchema();
    } catch (err) {
      this.logger.warn("Schema introspection failed: %s", (err as Error).message);
      return { nodeLabels: [], relationshipTypes: [], nodeCounts: {}, edgeCounts: {} };
    }
  }

  /** Schema scoped to a specific agent — only entities/relationships this agent created or produced. */
  private async getAgentScopedSchema(agentName: string): Promise<SchemaOverview> {
    const nodeQuery = `
      MATCH (n)-[:CREATED_BY]->(ag:Agent {name: $agentName})
      RETURN labels(n) AS nodeLabels, count(n) AS cnt
      UNION ALL
      MATCH (t:DecisionTrace)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
      RETURN labels(t) AS nodeLabels, count(t) AS cnt
      UNION ALL
      MATCH (t:DecisionTrace)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
      MATCH (t)-[]->(related)
      RETURN labels(related) AS nodeLabels, count(related) AS cnt
    `;

    const relQuery = `
      MATCH (n)-[:CREATED_BY]->(ag:Agent {name: $agentName})
      MATCH (n)-[r]->()
      RETURN type(r) AS relType, count(r) AS cnt
      UNION ALL
      MATCH (t:DecisionTrace)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
      MATCH (t)-[r]->()
      RETURN type(r) AS relType, count(r) AS cnt
    `;

    const params = { agentName };
    const [nodeResult, relResult] = await Promise.all([
      this.client.queryReadonly(nodeQuery, this.graph, params),
      this.client.queryReadonly(relQuery, this.graph, params),
    ]);

    const nodeCounts: Record<string, number> = {};
    for (const record of nodeResult.records || []) {
      const rawLabels = record[0];
      const count = Number(record[1] ?? 0);
      // labels() returns an array — use the first label
      const label = Array.isArray(rawLabels) ? String(rawLabels[0] ?? "") : String(rawLabels ?? "");
      if (label) {
        nodeCounts[label] = (nodeCounts[label] ?? 0) + count;
      }
    }

    const edgeCounts: Record<string, number> = {};
    for (const record of relResult.records || []) {
      const relType = String(record[0] ?? "");
      const count = Number(record[1] ?? 0);
      if (relType) {
        edgeCounts[relType] = (edgeCounts[relType] ?? 0) + count;
      }
    }

    // Exclude internal structural types the agent doesn't need to know about
    // Exclude ALL framework-internal types — the brain map should only show
    // domain entities the agent created (CodeFile, Contract, DesignDecision, etc.)
    const excludeLabels = new Set([
      "Agent", "Project", "Domain",
      "DecisionTrace", "Intent", "Action", "Constraint",
      "Tool", "Concept", "Skill",
    ]);
    const excludeRels = new Set([
      "MEMBER_OF", "BELONGS_TO_PROJECT", "CREATED_BY", "PRODUCED_BY",
      "HAS_INTENT", "TOOK_ACTION", "HAS_CONSTRAINT",
      "USED_TOOL", "TAGGED_WITH", "PRECEDENT_OF", "CONTRIBUTES_TO",
      "BELONGS_TO_DOMAIN", "OPERATES_IN", "DERIVED_FROM_CONCEPT",
    ]);

    const nodeLabels = Object.keys(nodeCounts).filter((l) => !excludeLabels.has(l));
    const relationshipTypes = Object.keys(edgeCounts).filter((r) => !excludeRels.has(r));

    // Clean up excluded entries from counts
    for (const l of excludeLabels) delete nodeCounts[l];
    for (const r of excludeRels) delete edgeCounts[r];

    return { nodeLabels, relationshipTypes, nodeCounts, edgeCounts };
  }

  /** Schema scoped to the project (used when no agent name is set). */
  private async getProjectScopedSchema(): Promise<SchemaOverview> {
    const nodeQuery = `
      MATCH (n)-[:BELONGS_TO_PROJECT]->(p:Project)
      WHERE p.name = $project AND p.tenant = $tenant
      RETURN labels(n) AS nodeLabels, count(n) AS cnt
    `;

    const relQuery = `
      MATCH (n)-[:BELONGS_TO_PROJECT]->(p:Project)
      WHERE p.name = $project AND p.tenant = $tenant
      MATCH (n)-[r]->()
      RETURN type(r) AS relType, count(r) AS cnt
    `;

    const params = { project: this.project, tenant: this.tenant };
    const [nodeResult, relResult] = await Promise.all([
      this.client.queryReadonly(nodeQuery, this.graph, params),
      this.client.queryReadonly(relQuery, this.graph, params),
    ]);

    const nodeCounts: Record<string, number> = {};
    for (const record of nodeResult.records || []) {
      const rawLabels = record[0];
      const count = Number(record[1] ?? 0);
      const label = Array.isArray(rawLabels) ? String(rawLabels[0] ?? "") : String(rawLabels ?? "");
      if (label) {
        nodeCounts[label] = (nodeCounts[label] ?? 0) + count;
      }
    }

    const edgeCounts: Record<string, number> = {};
    for (const record of relResult.records || []) {
      const relType = String(record[0] ?? "");
      const count = Number(record[1] ?? 0);
      if (relType) {
        edgeCounts[relType] = (edgeCounts[relType] ?? 0) + count;
      }
    }

    // Exclude ALL framework-internal types — the brain map should only show
    // domain entities the agent created (CodeFile, Contract, DesignDecision, etc.)
    const excludeLabels = new Set([
      "Agent", "Project", "Domain",
      "DecisionTrace", "Intent", "Action", "Constraint",
      "Tool", "Concept", "Skill",
    ]);
    const excludeRels = new Set([
      "MEMBER_OF", "BELONGS_TO_PROJECT", "CREATED_BY", "PRODUCED_BY",
      "HAS_INTENT", "TOOK_ACTION", "HAS_CONSTRAINT",
      "USED_TOOL", "TAGGED_WITH", "PRECEDENT_OF", "CONTRIBUTES_TO",
      "BELONGS_TO_DOMAIN", "OPERATES_IN", "DERIVED_FROM_CONCEPT",
    ]);

    const nodeLabels = Object.keys(nodeCounts).filter((l) => !excludeLabels.has(l));
    const relationshipTypes = Object.keys(edgeCounts).filter((r) => !excludeRels.has(r));

    for (const l of excludeLabels) delete nodeCounts[l];
    for (const r of excludeRels) delete edgeCounts[r];

    return { nodeLabels, relationshipTypes, nodeCounts, edgeCounts };
  }

  // ── Dynamic Entity Management ───────────────────────────────────────────────

  /** Create a dynamic entity (arbitrary node) in the graph. */
  async createEntity(entity: Omit<GraphEntity, "id">): Promise<string> {
    const label = sanitizeLabel(entity.label);
    const props: Record<string, string | number | boolean> = {
      ...entity.properties,
      createdAt: entity.createdAt,
    };
    // Ensure every node has a name for visualization.
    // Try common property names, then fall back to the first string property, then label.
    if (!props.name) {
      const fallback =
        entity.properties.path ??
        entity.properties.title ??
        entity.properties.description ??
        entity.properties.decision ??
        Object.values(entity.properties).find((v) => typeof v === "string") ??
        label;
      props.name = truncateName(String(fallback));
    }
    if (entity.createdBy) {
      props.createdBy = entity.createdBy;
    }

    // Build SET clause from properties
    const propEntries = Object.entries(props);
    const setClause = propEntries
      .map(([key, _], i) => `n.${sanitizeProperty(key)} = $prop_${i}`)
      .join(", ");

    const params: Record<string, unknown> = {};
    propEntries.forEach(([_, val], i) => {
      params[`prop_${i}`] = val;
    });

    const query = `CREATE (n:${label}) SET ${setClause} RETURN id(n) AS entityId`;

    const result = await this.client.query(query, this.graph, params);
    const entityId = String(result.records[0][0]);

    // Link to project (non-fatal — entity still usable if link fails)
    try {
      await this.client.query(
        `MATCH (n), (p:Project) WHERE id(n) = $entityId AND p.name = $project AND p.tenant = $tenant CREATE (n)-[:BELONGS_TO_PROJECT]->(p)`,
        this.graph,
        { entityId: Number(entityId), project: this.project, tenant: this.tenant }
      );
    } catch (err) {
      this.logger.warn("Entity-project link failed: %s", (err as Error).message);
    }

    // Link to agent (non-fatal)
    if (entity.createdBy) {
      await this.ensureAgent(entity.createdBy);
      try {
        await this.client.query(
          `MATCH (n), (ag:Agent) WHERE id(n) = $entityId AND ag.name = $agentName CREATE (n)-[:CREATED_BY]->(ag)`,
          this.graph,
          { entityId: Number(entityId), agentName: entity.createdBy }
        );
      } catch (err) {
        this.logger.warn("Entity-agent link failed: %s", (err as Error).message);
      }
    }

    this.logger.debug("Created entity: %s (label: %s)", entityId, label);
    return entityId;
  }

  /** Create a dynamic relationship between two nodes. */
  async createRelationship(rel: Omit<GraphRelationship, "id">): Promise<void> {
    const relType = sanitizeLabel(rel.type);
    const propEntries = Object.entries(rel.properties ?? {});

    let propClause = "";
    const params: Record<string, unknown> = {
      sourceId: Number(rel.sourceId),
      targetId: Number(rel.targetId),
    };

    if (propEntries.length > 0) {
      const setParts = propEntries.map(([key, _], i) => `r.${sanitizeProperty(key)} = $rp_${i}`);
      propClause = ` SET ${setParts.join(", ")}`;
      propEntries.forEach(([_, val], i) => {
        params[`rp_${i}`] = val;
      });
    }

    if (rel.createdBy) {
      propClause += `${propClause ? "," : " SET"} r.createdBy = $createdBy`;
      params.createdBy = rel.createdBy;
    }
    propClause += `${propClause ? "," : " SET"} r.createdAt = $createdAt`;
    params.createdAt = rel.createdAt;

    const query = `MATCH (a), (b) WHERE id(a) = $sourceId AND id(b) = $targetId CREATE (a)-[r:${relType}]->(b)${propClause}`;

    try {
      await this.client.query(query, this.graph, params);
      this.logger.debug("Created relationship: %s -> %s [%s]", rel.sourceId, rel.targetId, relType);
    } catch (err) {
      this.logger.warn("Failed to create relationship: %s", (err as Error).message);
      throw err;
    }
  }

  /** Find entities by label with optional property filter. */
  async findEntities(label: string, filter?: Record<string, string | number | boolean>): Promise<GraphEntity[]> {
    const safeLabel = sanitizeLabel(label);
    const params: Record<string, unknown> = {};
    let whereClause = "";

    if (filter) {
      const conditions = Object.entries(filter).map(([key, val], i) => {
        params[`f_${i}`] = val;
        return `n.${sanitizeProperty(key)} = $f_${i}`;
      });
      whereClause = ` WHERE ${conditions.join(" AND ")}`;
    }

    const query = `MATCH (n:${safeLabel})${whereClause} RETURN n ORDER BY n.createdAt DESC LIMIT 50`;

    try {
      const result = await this.client.queryReadonly(query, this.graph, params);
      return (result.records || []).map((r: unknown[]) => {
        const node = r[0] as any;
        const props = node?.properties ?? node ?? {};
        return {
          id: String(node?.id ?? ""),
          label: safeLabel,
          properties: { ...props },
          createdBy: props.createdBy ? String(props.createdBy) : undefined,
          createdAt: String(props.createdAt ?? ""),
        };
      });
    } catch (err) {
      this.logger.warn("Entity search failed: %s", (err as Error).message);
      return [];
    }
  }

  /** Get entities connected to a specific node. */
  async getConnectedEntities(nodeId: string, direction: "outgoing" | "incoming" | "both" = "both"): Promise<{ entity: GraphEntity; relationship: string; direction: string }[]> {
    const patterns: Record<string, string> = {
      outgoing: `MATCH (n)-[r]->(m) WHERE id(n) = $nodeId RETURN m, type(r) AS relType, 'outgoing' AS dir`,
      incoming: `MATCH (n)<-[r]-(m) WHERE id(n) = $nodeId RETURN m, type(r) AS relType, 'incoming' AS dir`,
      both: `MATCH (n)-[r]-(m) WHERE id(n) = $nodeId RETURN m, type(r) AS relType, CASE WHEN startNode(r) = n THEN 'outgoing' ELSE 'incoming' END AS dir`,
    };

    try {
      const result = await this.client.queryReadonly(
        patterns[direction],
        this.graph,
        { nodeId: Number(nodeId) }
      );

      return (result.records || []).map((r: unknown[]) => {
        const node = r[0] as any;
        const props = node?.properties ?? node ?? {};
        const labels = node?.labels ?? [];
        return {
          entity: {
            id: String(node?.id ?? ""),
            label: labels[0] ?? "Unknown",
            properties: { ...props },
            createdAt: String(props.createdAt ?? ""),
          },
          relationship: String(r[1]),
          direction: String(r[2]),
        };
      });
    } catch (err) {
      this.logger.warn("Connected entities query failed: %s", (err as Error).message);
      return [];
    }
  }

  getClient(): GraphmindClient {
    return this.client;
  }

  getGraphName(): string {
    return this.graph;
  }

  getProject(): string {
    return this.project;
  }

  getTenant(): string {
    return this.tenant;
  }

  getAgentName(): string | undefined {
    return this.agentName;
  }
}

// ── Naming & Sanitization Helpers ─────────────────────────────────────────────

/** Truncate a description into a short name for graph visualization. */
function truncateName(description: string, maxLen = 60): string {
  if (!description) return "unnamed";
  const clean = description.replace(/\s+/g, " ").trim();
  return clean.length <= maxLen ? clean : clean.substring(0, maxLen - 1) + "…";
}

/** Sanitize a label or relationship type for safe use in Cypher (prevents injection). */
function sanitizeLabel(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Sanitize a property name for safe use in Cypher. */
function sanitizeProperty(value: string): string {
  return value.replace(/[^a-zA-Z0-9_]/g, "_");
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
  const toolNames = record[8] as string[] | null;

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

  // Tool names from the reusable Tool nodes (call data is on the USED_TOOL edges)
  if (toolNames && toolNames.length > 0) {
    base.toolCalls = toolNames.filter(Boolean).map((name) => ({
      name: String(name),
      args: "",
      createdAt: "",
    }));
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
