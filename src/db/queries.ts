export const SCHEMA_QUERIES = {
  // Property indexes
  createIntentIndex: `CREATE INDEX IF NOT EXISTS FOR (n:Intent) ON (n.description)`,
  createConstraintIndex: `CREATE INDEX IF NOT EXISTS FOR (n:Constraint) ON (n.description)`,
  createActionIndex: `CREATE INDEX IF NOT EXISTS FOR (n:Action) ON (n.description)`,
  createTraceIndex: `CREATE INDEX IF NOT EXISTS FOR (n:DecisionTrace) ON (n.status)`,
  createProjectIndex: `CREATE INDEX IF NOT EXISTS FOR (n:Project) ON (n.name)`,
  createDomainIndex: `CREATE INDEX IF NOT EXISTS FOR (n:Domain) ON (n.name)`,
  createConceptIndex: `CREATE INDEX IF NOT EXISTS FOR (n:Concept) ON (n.name)`,
  createToolCallIndex: `CREATE INDEX IF NOT EXISTS FOR (n:ToolCall) ON (n.name)`,
  createAgentIndex: `CREATE INDEX IF NOT EXISTS FOR (n:Agent) ON (n.name)`,
  createSkillIndex: `CREATE INDEX IF NOT EXISTS FOR (n:Skill) ON (n.name)`,

  // Vector indexes (named, using Graphmind's FOR/ON syntax)
  createIntentVectorIndex: (dimensions: number, metric: string) =>
    `CREATE VECTOR INDEX intent_embedding FOR (n:Intent) ON (n.embedding) OPTIONS {dimensions: ${dimensions}, similarity: '${metric}'}`,
  createTraceVectorIndex: (dimensions: number, metric: string) =>
    `CREATE VECTOR INDEX trace_embedding FOR (n:DecisionTrace) ON (n.embedding) OPTIONS {dimensions: ${dimensions}, similarity: '${metric}'}`,
  createConceptVectorIndex: (dimensions: number, metric: string) =>
    `CREATE VECTOR INDEX concept_embedding FOR (n:Concept) ON (n.embedding) OPTIONS {dimensions: ${dimensions}, similarity: '${metric}'}`,
};

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
  getProject: `
    MATCH (p:Project {name: $name, tenant: $tenant})
    RETURN p
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
  getDomain: `
    MATCH (d:Domain {name: $name})
    RETURN d
  `,
};

export const AGENT_QUERIES = {
  /** MERGE an Agent node within a project. */
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
  /** Link an Agent to a Project. */
  linkAgentToProject: `
    MATCH (ag:Agent {name: $agentName}), (p:Project {name: $project, tenant: $tenant})
    MERGE (ag)-[:MEMBER_OF]->(p)
  `,
  /** Link an Agent to a Domain. */
  linkAgentToDomain: `
    MATCH (ag:Agent {name: $agentName}), (d:Domain {name: $domain})
    MERGE (ag)-[:OPERATES_IN]->(d)
  `,
  /** Get all agents in a project. */
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

export const TOOLCALL_QUERIES = {
  /** Create a ToolCall node and link it to a trace. */
  createToolCallForTrace: `
    MATCH (t:DecisionTrace)
    WHERE id(t) = $traceId
    CREATE (t)-[:USED_TOOL]->(tc:ToolCall {
      name: $name,
      args: $args,
      result: $result,
      durationMs: $durationMs,
      createdAt: $createdAt
    })
    RETURN id(tc) AS toolCallId
  `,
  /** Get all tool calls for a trace. */
  getToolCallsByTrace: `
    MATCH (t:DecisionTrace)-[:USED_TOOL]->(tc:ToolCall)
    WHERE id(t) = $traceId
    RETURN tc
    ORDER BY tc.createdAt ASC
  `,
  /** Get tool usage statistics across a project. */
  getToolStatsByProject: `
    MATCH (p:Project {name: $project})<-[:BELONGS_TO_PROJECT]-(t:DecisionTrace)-[:USED_TOOL]->(tc:ToolCall)
    RETURN tc.name AS toolName, count(tc) AS callCount
    ORDER BY callCount DESC
  `,
  /** Get tool usage statistics for a specific agent. */
  getToolStatsByAgent: `
    MATCH (ag:Agent {name: $agentName})<-[:PRODUCED_BY]-(t:DecisionTrace)-[:USED_TOOL]->(tc:ToolCall)
    RETURN tc.name AS toolName, count(tc) AS callCount
    ORDER BY callCount DESC
  `,
};

export const SKILL_QUERIES = {
  /** Create or update a Skill node. */
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

  /** Link a Skill to a Project. */
  linkSkillToProject: `
    MATCH (s:Skill {name: $skillName}), (p:Project {name: $project, tenant: $tenant})
    MERGE (s)-[:BELONGS_TO_PROJECT]->(p)
  `,

  /** Link a Skill to a Concept it was derived from. */
  linkSkillToConcept: `
    MATCH (s:Skill {name: $skillName}), (c:Concept {name: $conceptName})
    MERGE (s)-[:DERIVED_FROM_CONCEPT]->(c)
  `,

  /** Link a Skill to a Domain. */
  linkSkillToDomain: `
    MATCH (s:Skill {name: $skillName}), (d:Domain {name: $domain})
    MERGE (s)-[:BELONGS_TO_DOMAIN]->(d)
  `,

  /** Link a synthesized trace to the skill it contributed to. */
  linkTraceToSkill: `
    MATCH (t:DecisionTrace), (s:Skill {name: $skillName})
    WHERE id(t) = $traceId
    MERGE (t)-[:CONTRIBUTES_TO]->(s)
  `,

  /** Get all skills for a project (lightweight manifest). */
  getSkillsByProject: `
    MATCH (s:Skill)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    OPTIONAL MATCH (s)-[:DERIVED_FROM_CONCEPT]->(c:Concept)
    OPTIONAL MATCH (s)-[:BELONGS_TO_DOMAIN]->(d:Domain)
    RETURN s, collect(DISTINCT c.name) AS concepts, d.name AS domain
    ORDER BY s.confidence DESC
  `,

  /** Get a single skill by name with full details. */
  getSkillByName: `
    MATCH (s:Skill {name: $name})
    OPTIONAL MATCH (s)-[:DERIVED_FROM_CONCEPT]->(c:Concept)
    OPTIONAL MATCH (s)-[:BELONGS_TO_DOMAIN]->(d:Domain)
    OPTIONAL MATCH (t:DecisionTrace)-[:CONTRIBUTES_TO]->(s)
    OPTIONAL MATCH (t)-[:USED_TOOL]->(tc:ToolCall)
    RETURN s, collect(DISTINCT c.name) AS concepts, d.name AS domain, collect(DISTINCT tc.name) AS tools
  `,

  /** Get synthesized traces grouped by their shared concepts (for auto-skill creation). */
  getSynthesizedTracesByConcept: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    WHERE t.status = 'synthesized'
    MATCH (t)-[:TAGGED_WITH]->(c:Concept)
    OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
    OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
    OPTIONAL MATCH (t)-[:BELONGS_TO_DOMAIN]->(d:Domain)
    OPTIONAL MATCH (t)-[:USED_TOOL]->(tc:ToolCall)
    RETURN c.name AS concept, collect(DISTINCT {
      traceId: id(t),
      intent: i.description,
      action: a.description,
      justification: t.justification_description,
      confidence: t.justification_confidence,
      domain: d.name,
      tools: collect(DISTINCT tc.name)
    }) AS traces
    ORDER BY size(traces) DESC
  `,
};

export const TRACE_QUERIES = {
  /** Create trace + intent + action (domain removed from properties — linked via relationship). */
  createDecisionTrace: `
    CREATE (t:DecisionTrace {
      status: $status,
      justification_description: $justification_description,
      justification_confidence: $justification_confidence,
      justification_ablationScore: $justification_ablationScore,
      embedding: $trace_embedding,
      createdAt: $createdAt,
      updatedAt: $updatedAt
    })
    CREATE (i:Intent {
      description: $intent_description,
      embedding: $intent_embedding,
      createdAt: $createdAt
    })
    CREATE (a:Action {
      description: $action_description,
      outcome: $action_outcome,
      embedding: $action_embedding,
      createdAt: $createdAt
    })
    CREATE (t)-[:HAS_INTENT]->(i)
    CREATE (t)-[:TOOK_ACTION]->(a)
    RETURN id(t) AS traceId
  `,

  /** Link trace to Project node. */
  linkTraceToProject: `
    MATCH (t:DecisionTrace), (p:Project {name: $project, tenant: $tenant})
    WHERE id(t) = $traceId
    CREATE (t)-[:BELONGS_TO_PROJECT]->(p)
  `,

  /** Link trace to Domain node. */
  linkTraceToDomain: `
    MATCH (t:DecisionTrace), (d:Domain {name: $domain})
    WHERE id(t) = $traceId
    CREATE (t)-[:BELONGS_TO_DOMAIN]->(d)
  `,

  /** Link trace to the Agent that produced it. */
  linkTraceToAgent: `
    MATCH (t:DecisionTrace), (ag:Agent {name: $agentName})
    WHERE id(t) = $traceId
    CREATE (t)-[:PRODUCED_BY]->(ag)
  `,

  createConstraintForTrace: `
    MATCH (t:DecisionTrace)
    WHERE id(t) = $traceId
    CREATE (t)-[:HAS_CONSTRAINT]->(con:Constraint {
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
    OPTIONAL MATCH (t)-[:USED_TOOL]->(tc:ToolCall)
    RETURN t, i, collect(DISTINCT con) AS constraints, a, p, d, ag, collect(DISTINCT c) AS concepts, collect(DISTINCT tc) AS toolCalls
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

  /** Atomically update both status and confidence on a trace. */
  updateTraceStatusAndConfidence: `
    MATCH (t:DecisionTrace)
    WHERE id(t) = $traceId
    SET t.status = $status, t.justification_confidence = $confidence, t.updatedAt = $updatedAt
    RETURN t
  `,

  /** Get active rules — shared mode (all traces in project). */
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

  /** Get active rules — isolated to a specific agent. */
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

  /** Count traces for a specific agent within a project. */
  countTracesByAgent: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    MATCH (t)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
    RETURN count(t) AS count
  `,

  getLifecycleStats: `
    MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
    RETURN t.status AS status, count(t) AS count
  `,

  /** Get trace IDs by status (useful for batch validation). */
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
  /** Vector must be inlined as a literal — Graphmind SEARCH does not accept $params for vectors. */
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

  /** Search traces scoped to specific agent(s) — for isolated/selective sharing. */
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

  /** Vector must be inlined as a literal — Graphmind SEARCH does not accept $params for vectors. */
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
