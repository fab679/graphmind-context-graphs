export const SCHEMA_QUERIES = {
  // Property indexes
  createIntentIndex: `CREATE INDEX idx_intent_description IF NOT EXISTS FOR (n:Intent) ON (n.description)`,
  createConstraintIndex: `CREATE INDEX idx_constraint_description IF NOT EXISTS FOR (n:Constraint) ON (n.description)`,
  createActionIndex: `CREATE INDEX idx_action_description IF NOT EXISTS FOR (n:Action) ON (n.description)`,
  createTraceIndex: `CREATE INDEX idx_trace_status IF NOT EXISTS FOR (n:DecisionTrace) ON (n.status)`,
  createProjectIndex: `CREATE INDEX idx_project_name IF NOT EXISTS FOR (n:Project) ON (n.name)`,
  createDomainIndex: `CREATE INDEX idx_domain_name IF NOT EXISTS FOR (n:Domain) ON (n.name)`,
  createConceptIndex: `CREATE INDEX idx_concept_name IF NOT EXISTS FOR (n:Concept) ON (n.name)`,
  createToolIndex: `CREATE INDEX idx_tool_name IF NOT EXISTS FOR (n:Tool) ON (n.name)`,
  createAgentIndex: `CREATE INDEX idx_agent_name IF NOT EXISTS FOR (n:Agent) ON (n.name)`,
  createSkillIndex: `CREATE INDEX idx_skill_name IF NOT EXISTS FOR (n:Skill) ON (n.name)`,

  // Vector indexes
  createIntentVectorIndex: (dimensions: number, metric: string) =>
    `CREATE VECTOR INDEX intent_embedding IF NOT EXISTS FOR (n:Intent) ON (n.embedding) OPTIONS {dimensions: ${dimensions}, similarity: '${metric}'}`,
  createTraceVectorIndex: (dimensions: number, metric: string) =>
    `CREATE VECTOR INDEX trace_embedding IF NOT EXISTS FOR (n:DecisionTrace) ON (n.embedding) OPTIONS {dimensions: ${dimensions}, similarity: '${metric}'}`,
  createConceptVectorIndex: (dimensions: number, metric: string) =>
    `CREATE VECTOR INDEX concept_embedding IF NOT EXISTS FOR (n:Concept) ON (n.embedding) OPTIONS {dimensions: ${dimensions}, similarity: '${metric}'}`,
};

// ── Structural Node Queries (MERGE for idempotent creation) ───────────────────

export const PROJECT_QUERIES = {
  mergeProject: `
    MERGE (p:Project {name: $name, tenant: $tenant})
    ON CREATE SET p.description = $description, p.createdAt = $createdAt
    RETURN id(p) AS projectId
  `,
  mergeProjectSimple: `
    MERGE (p:Project {name: $name, tenant: $tenant})
    ON CREATE SET p.createdAt = $createdAt
    RETURN id(p) AS projectId
  `,
};

export const DOMAIN_QUERIES = {
  mergeDomain: `
    MERGE (d:Domain {name: $name})
    ON CREATE SET d.description = $description, d.createdAt = $createdAt
    RETURN id(d) AS domainId
  `,
  mergeDomainSimple: `
    MERGE (d:Domain {name: $name})
    ON CREATE SET d.createdAt = $createdAt
    RETURN id(d) AS domainId
  `,
};

export const AGENT_QUERIES = {
  mergeAgent: `
    MERGE (ag:Agent {name: $name})
    ON CREATE SET ag.description = $description, ag.createdAt = $createdAt
    RETURN id(ag) AS agentId
  `,
  mergeAgentSimple: `
    MERGE (ag:Agent {name: $name})
    ON CREATE SET ag.createdAt = $createdAt
    RETURN id(ag) AS agentId
  `,
  linkAgentToProject: `
    MATCH (ag:Agent {name: $agentName})
    MERGE (p:Project {name: $project, tenant: $tenant})
    MERGE (ag)-[:MEMBER_OF]->(p)
  `,
  linkAgentToDomain: `
    MATCH (ag:Agent {name: $agentName})
    MERGE (d:Domain {name: $domain})
    MERGE (ag)-[:OPERATES_IN]->(d)
  `,
  getAgentsByProject: `
    MATCH (ag:Agent)-[:MEMBER_OF]->(p:Project {name: $project, tenant: $tenant})
    RETURN ag.name AS name, ag.description AS description
  `,
};

export const CONCEPT_QUERIES = {
  mergeConcept: `
    MERGE (c:Concept {name: $name})
    ON CREATE SET c.description = $description, c.embedding = $embedding, c.createdAt = $createdAt
    RETURN id(c) AS conceptId
  `,
  mergeConceptSimple: `
    MERGE (c:Concept {name: $name})
    ON CREATE SET c.createdAt = $createdAt
    RETURN id(c) AS conceptId
  `,
  updateConceptEmbedding: `
    MATCH (c:Concept {name: $name})
    SET c.embedding = $embedding
    RETURN id(c) AS conceptId
  `,
  /** Link trace to concept. ensureConcept() must be called first. */
  linkTraceToConcept: `
    MATCH (t:DecisionTrace), (c:Concept {name: $conceptName})
    WHERE id(t) = $traceId
    CREATE (t)-[:TAGGED_WITH]->(c)
  `,
  getTracesByConcept: `
    MATCH (c:Concept {name: $conceptName})<-[:TAGGED_WITH]-(t:DecisionTrace)
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    RETURN t, i, collect(con) AS constraints, a
    ORDER BY t.updatedAt DESC
  `,
  getConceptsByProject: `
    MATCH (p:Project {name: $project})<-[:BELONGS_TO_PROJECT]-(t:DecisionTrace)-[:TAGGED_WITH]->(c:Concept)
    RETURN DISTINCT c.name AS name, c.description AS description, count(t) AS traceCount
    ORDER BY traceCount DESC
  `,
};

export const TOOL_QUERIES = {
  /** MERGE a reusable Tool node (one per unique tool name). */
  mergeTool: `
    MERGE (tool:Tool {name: $name})
    ON CREATE SET tool.createdAt = $createdAt
    RETURN id(tool) AS toolId
  `,

  /** Link trace to tool. ensureTool() must be called first. */
  linkTraceToTool: `
    MATCH (t:DecisionTrace), (tool:Tool {name: $toolName})
    WHERE id(t) = $traceId
    CREATE (t)-[:USED_TOOL]->(tool)
  `,

  /** Get all tool usages for a trace. */
  getToolUsageByTrace: `
    MATCH (t:DecisionTrace)-[r:USED_TOOL]->(tool:Tool)
    WHERE id(t) = $traceId
    RETURN tool.name AS name, r.args AS args, r.result AS result, r.durationMs AS durationMs, r.createdAt AS createdAt
    ORDER BY r.createdAt ASC
  `,

  /** Get tool usage statistics across a project. */
  getToolStatsByProject: `
    MATCH (p:Project {name: $project})<-[:BELONGS_TO_PROJECT]-(t:DecisionTrace)-[r:USED_TOOL]->(tool:Tool)
    RETURN tool.name AS toolName, count(r) AS callCount
    ORDER BY callCount DESC
  `,

  /** Get tool usage statistics for a specific agent. */
  getToolStatsByAgent: `
    MATCH (ag:Agent {name: $agentName})<-[:PRODUCED_BY]-(t:DecisionTrace)-[r:USED_TOOL]->(tool:Tool)
    RETURN tool.name AS toolName, count(r) AS callCount
    ORDER BY callCount DESC
  `,
};

export const SKILL_QUERIES = {
  /** Upsert a Skill node. */
  mergeSkill: `
    MERGE (s:Skill {name: $name})
    ON CREATE SET
      s.description = $description,
      s.prompt = $prompt,
      s.confidence = $confidence,
      s.traceCount = $traceCount,
      s.createdAt = $createdAt,
      s.updatedAt = $updatedAt
    ON MATCH SET
      s.description = $description,
      s.prompt = $prompt,
      s.confidence = $confidence,
      s.traceCount = $traceCount,
      s.updatedAt = $updatedAt
    RETURN id(s) AS skillId
  `,

  linkSkillToProject: `
    MATCH (s:Skill {name: $skillName}), (p:Project {name: $project, tenant: $tenant})
    MERGE (s)-[:BELONGS_TO_PROJECT]->(p)
  `,
  linkSkillToConcept: `
    MATCH (s:Skill {name: $skillName}), (c:Concept {name: $conceptName})
    MERGE (s)-[:DERIVED_FROM_CONCEPT]->(c)
  `,
  linkSkillToDomain: `
    MATCH (s:Skill {name: $skillName}), (d:Domain {name: $domain})
    MERGE (s)-[:BELONGS_TO_DOMAIN]->(d)
  `,
  linkTraceToSkill: `
    MATCH (t:DecisionTrace), (s:Skill {name: $skillName})
    WHERE id(t) = $traceId
    MERGE (t)-[:CONTRIBUTES_TO]->(s)
  `,

  getSkillsByProject: `
    MATCH (s:Skill)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    OPTIONAL MATCH (s)-[:DERIVED_FROM_CONCEPT]->(c:Concept)
    OPTIONAL MATCH (s)-[:BELONGS_TO_DOMAIN]->(d:Domain)
    RETURN s, collect(DISTINCT c.name) AS concepts, d.name AS domain
    ORDER BY s.confidence DESC
  `,
  getSkillByName: `
    MATCH (s:Skill {name: $name})
    OPTIONAL MATCH (s)-[:DERIVED_FROM_CONCEPT]->(c:Concept)
    OPTIONAL MATCH (s)-[:BELONGS_TO_DOMAIN]->(d:Domain)
    OPTIONAL MATCH (t:DecisionTrace)-[:CONTRIBUTES_TO]->(s)
    OPTIONAL MATCH (t)-[:USED_TOOL]->(tool:Tool)
    RETURN s, collect(DISTINCT c.name) AS concepts, d.name AS domain, collect(DISTINCT tool.name) AS tools
  `,

  getSynthesizedTracesWithConcepts: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    WHERE t.status = 'synthesized'
    MATCH (t)-[:TAGGED_WITH]->(c:Concept)
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    OPTIONAL MATCH (t)-[:BELONGS_TO_DOMAIN]->(d:Domain)
    RETURN c.name AS concept, id(t) AS traceId, i.description AS intent, a.description AS action, t.justification_description AS justification, t.justification_confidence AS confidence, d.name AS domain
    ORDER BY concept
  `,
};

export const TRACE_QUERIES = {
  /**
   * Create trace + intent + action with inline relationships and name properties.
   * Names are truncated descriptions for visualization in Graphmind UI.
   */
  createDecisionTrace: `
    CREATE (t:DecisionTrace {
      name: $trace_name,
      status: $status,
      justification_description: $justification_description,
      justification_confidence: $justification_confidence,
      justification_ablationScore: $justification_ablationScore,
      embedding: $trace_embedding,
      createdAt: $createdAt,
      updatedAt: $updatedAt
    })
    CREATE (i:Intent {
      name: $intent_name,
      description: $intent_description,
      embedding: $intent_embedding,
      createdAt: $createdAt
    })
    CREATE (a:Action {
      name: $action_name,
      description: $action_description,
      outcome: $action_outcome,
      embedding: $action_embedding,
      createdAt: $createdAt
    })
    CREATE (t)-[:HAS_INTENT]->(i)
    CREATE (t)-[:TOOK_ACTION]->(a)
    RETURN id(t) AS traceId
  `,

  /**
   * Link queries use MATCH on both sides. The ensure* methods must be called
   * first to guarantee the target node exists.
   *
   * NOTE: MATCH+MERGE in a single query creates ghost nodes with empty labels
   * in Graphmind — another bug with the Issue 3 fix. So we use ensure* + MATCH.
   */
  linkTraceToProject: `
    MATCH (t:DecisionTrace), (p:Project {name: $project, tenant: $tenant})
    WHERE id(t) = $traceId
    CREATE (t)-[:BELONGS_TO_PROJECT]->(p)
  `,
  linkTraceToDomain: `
    MATCH (t:DecisionTrace), (d:Domain {name: $domain})
    WHERE id(t) = $traceId
    CREATE (t)-[:BELONGS_TO_DOMAIN]->(d)
  `,
  linkTraceToAgent: `
    MATCH (t:DecisionTrace), (ag:Agent {name: $agentName})
    WHERE id(t) = $traceId
    CREATE (t)-[:PRODUCED_BY]->(ag)
  `,

  /** Create constraint inline from matched trace with name property. */
  createConstraintForTrace: `
    MATCH (t:DecisionTrace)
    WHERE id(t) = $traceId
    CREATE (t)-[:HAS_CONSTRAINT]->(con:Constraint {
      name: $name,
      description: $description,
      type: $type,
      embedding: $embedding,
      createdAt: $createdAt
    })
    RETURN id(con) AS constraintId
  `,

  getTraceById: `
    MATCH (t:DecisionTrace)
    WHERE id(t) = $traceId
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    OPTIONAL MATCH (t)-[:BELONGS_TO_PROJECT]->(p:Project)
    OPTIONAL MATCH (t)-[:BELONGS_TO_DOMAIN]->(d:Domain)
    OPTIONAL MATCH (t)-[:PRODUCED_BY]->(ag:Agent)
    OPTIONAL MATCH (t)-[:TAGGED_WITH]->(c:Concept)
    OPTIONAL MATCH (t)-[tu:USED_TOOL]->(tool:Tool)
    RETURN t, i, collect(DISTINCT con) AS constraints, a, p, d, ag, collect(DISTINCT c) AS concepts, collect(DISTINCT tool.name) AS toolNames
  `,

  updateTraceStatus: `
    MATCH (t:DecisionTrace)
    WHERE id(t) = $traceId
    SET t.status = $status, t.updatedAt = $updatedAt
    RETURN t
  `,
  updateTraceConfidence: `
    MATCH (t:DecisionTrace)
    WHERE id(t) = $traceId
    SET t.justification_confidence = $confidence, t.updatedAt = $updatedAt
    RETURN t
  `,
  updateTraceStatusAndConfidence: `
    MATCH (t:DecisionTrace)
    WHERE id(t) = $traceId
    SET t.status = $status, t.justification_confidence = $confidence, t.updatedAt = $updatedAt
    RETURN t
  `,

  getActiveRules: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    WHERE t.status = 'synthesized'
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    OPTIONAL MATCH (t)-[:TAGGED_WITH]->(c:Concept)
    RETURN t, i, collect(DISTINCT con) AS constraints, a, collect(DISTINCT c) AS concepts
    ORDER BY t.justification_confidence DESC
  `,
  getActiveRulesByAgent: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    MATCH (t)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
    WHERE t.status = 'synthesized'
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    OPTIONAL MATCH (t)-[:TAGGED_WITH]->(c:Concept)
    RETURN t, i, collect(DISTINCT con) AS constraints, a, collect(DISTINCT c) AS concepts
    ORDER BY t.justification_confidence DESC
  `,

  getAntiPatterns: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    WHERE t.status = 'anti_pattern'
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    RETURN t, i, collect(DISTINCT con) AS constraints, a
    ORDER BY t.updatedAt DESC
  `,
  getAntiPatternsByAgent: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    MATCH (t)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
    WHERE t.status = 'anti_pattern'
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    RETURN t, i, collect(DISTINCT con) AS constraints, a
    ORDER BY t.updatedAt DESC
  `,

  createPrecedentLink: `
    MATCH (t1:DecisionTrace), (t2:DecisionTrace)
    WHERE id(t1) = $sourceId AND id(t2) = $targetId
    CREATE (t1)-[:PRECEDENT_OF {similarity: $similarity}]->(t2)
  `,

  countTracesByProject: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    RETURN count(t) AS count
  `,
  countTracesByAgent: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    MATCH (t)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
    RETURN count(t) AS count
  `,

  getLifecycleStats: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    RETURN t.status AS status, count(t) AS count
  `,
  getTraceIdsByStatus: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    WHERE t.status = $status
    RETURN id(t) AS traceId
  `,

  getCandidatesForSynthesis: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    WHERE t.status = 'validated'
      AND t.justification_confidence >= $minConfidence
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    RETURN t, i, collect(DISTINCT con) AS constraints, a
  `,
  getCandidatesForPruning: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    WHERE t.status = 'validated'
      AND t.justification_confidence <= $maxConfidence
    RETURN id(t) AS traceId
  `,
};

export const VECTOR_QUERIES = {
  searchSimilarTraces: (vectorLiteral: string, topK: number) => `
    MATCH (t:DecisionTrace)
      SEARCH t IN (
        VECTOR INDEX trace_embedding
        FOR ${vectorLiteral}
        LIMIT ${topK}
      ) SCORE AS similarity
    OPTIONAL MATCH (t)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    WHERE p IS NOT NULL
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    OPTIONAL MATCH (t)-[:TAGGED_WITH]->(c:Concept)
    OPTIONAL MATCH (t)-[:PRODUCED_BY]->(ag:Agent)
    RETURN t, i, collect(DISTINCT con) AS constraints, a, similarity, collect(DISTINCT c) AS concepts, ag
    ORDER BY similarity DESC
  `,

  searchSimilarTracesByAgents: (vectorLiteral: string, topK: number, agentNames: string[]) => {
    const agentFilter = agentNames.map((n) => `"${n}"`).join(", ");
    return `
    MATCH (t:DecisionTrace)
      SEARCH t IN (
        VECTOR INDEX trace_embedding
        FOR ${vectorLiteral}
        LIMIT ${topK}
      ) SCORE AS similarity
    OPTIONAL MATCH (t)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    WHERE p IS NOT NULL
    MATCH (t)-[:PRODUCED_BY]->(ag:Agent)
    WHERE ag.name IN [${agentFilter}]
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    OPTIONAL MATCH (t)-[:TAGGED_WITH]->(c:Concept)
    RETURN t, i, collect(DISTINCT con) AS constraints, a, similarity, collect(DISTINCT c) AS concepts, ag
    ORDER BY similarity DESC
    `;
  },

  searchSimilarConcepts: (vectorLiteral: string, topK: number) => `
    MATCH (c:Concept)
      SEARCH c IN (
        VECTOR INDEX concept_embedding
        FOR ${vectorLiteral}
        LIMIT ${topK}
      ) SCORE AS similarity
    RETURN c.name AS name, c.description AS description, similarity
    ORDER BY similarity DESC
  `,
};
