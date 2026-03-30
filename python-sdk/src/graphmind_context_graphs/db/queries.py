"""All Cypher queries for the context graph. Mirrors the TypeScript queries.ts."""

# ── Schema Indexes ─────────────────────────────────────────────────────────────

SCHEMA_QUERIES = {
    "create_intent_index": "CREATE INDEX idx_intent_description IF NOT EXISTS FOR (n:Intent) ON (n.description)",
    "create_constraint_index": "CREATE INDEX idx_constraint_description IF NOT EXISTS FOR (n:Constraint) ON (n.description)",
    "create_action_index": "CREATE INDEX idx_action_description IF NOT EXISTS FOR (n:Action) ON (n.description)",
    "create_trace_index": "CREATE INDEX idx_trace_status IF NOT EXISTS FOR (n:DecisionTrace) ON (n.status)",
    "create_project_index": "CREATE INDEX idx_project_name IF NOT EXISTS FOR (n:Project) ON (n.name)",
    "create_domain_index": "CREATE INDEX idx_domain_name IF NOT EXISTS FOR (n:Domain) ON (n.name)",
    "create_concept_index": "CREATE INDEX idx_concept_name IF NOT EXISTS FOR (n:Concept) ON (n.name)",
    "create_tool_index": "CREATE INDEX idx_tool_name IF NOT EXISTS FOR (n:Tool) ON (n.name)",
    "create_agent_index": "CREATE INDEX idx_agent_name IF NOT EXISTS FOR (n:Agent) ON (n.name)",
    "create_skill_index": "CREATE INDEX idx_skill_name IF NOT EXISTS FOR (n:Skill) ON (n.name)",
}


def create_vector_index(name: str, label: str, dimensions: int, metric: str) -> str:
    return (
        f"CREATE VECTOR INDEX {name} IF NOT EXISTS FOR (n:{label}) "
        f"ON (n.embedding) OPTIONS {{dimensions: {dimensions}, similarity: '{metric}'}}"
    )


# ── Structural Nodes (MERGE for idempotent creation) ──────────────────────────

PROJECT_QUERIES = {
    "merge_project": """
        MERGE (p:Project {name: $name, tenant: $tenant})
        ON CREATE SET p.description = $description, p.createdAt = $createdAt
        RETURN id(p) AS projectId
    """,
    "merge_project_simple": """
        MERGE (p:Project {name: $name, tenant: $tenant})
        ON CREATE SET p.createdAt = $createdAt
        RETURN id(p) AS projectId
    """,
}

DOMAIN_QUERIES = {
    "merge_domain": """
        MERGE (d:Domain {name: $name})
        ON CREATE SET d.description = $description, d.createdAt = $createdAt
        RETURN id(d) AS domainId
    """,
    "merge_domain_simple": """
        MERGE (d:Domain {name: $name})
        ON CREATE SET d.createdAt = $createdAt
        RETURN id(d) AS domainId
    """,
}

AGENT_QUERIES = {
    "merge_agent": """
        MERGE (ag:Agent {name: $name})
        ON CREATE SET ag.description = $description, ag.createdAt = $createdAt
        RETURN id(ag) AS agentId
    """,
    "merge_agent_simple": """
        MERGE (ag:Agent {name: $name})
        ON CREATE SET ag.createdAt = $createdAt
        RETURN id(ag) AS agentId
    """,
    "link_agent_to_project": """
        MATCH (ag:Agent {name: $agentName})
        MERGE (p:Project {name: $project, tenant: $tenant})
        MERGE (ag)-[:MEMBER_OF]->(p)
    """,
    "link_agent_to_domain": """
        MATCH (ag:Agent {name: $agentName})
        MERGE (d:Domain {name: $domain})
        MERGE (ag)-[:OPERATES_IN]->(d)
    """,
    "get_agents_by_project": """
        MATCH (ag:Agent)-[:MEMBER_OF]->(p:Project {name: $project, tenant: $tenant})
        RETURN ag.name AS name, ag.description AS description
    """,
}

CONCEPT_QUERIES = {
    "merge_concept": """
        MERGE (c:Concept {name: $name})
        ON CREATE SET c.description = $description, c.embedding = $embedding, c.createdAt = $createdAt
        RETURN id(c) AS conceptId
    """,
    "merge_concept_simple": """
        MERGE (c:Concept {name: $name})
        ON CREATE SET c.createdAt = $createdAt
        RETURN id(c) AS conceptId
    """,
    "update_concept_embedding": """
        MATCH (c:Concept {name: $name})
        SET c.embedding = $embedding
        RETURN id(c) AS conceptId
    """,
    "link_trace_to_concept": """
        MATCH (t:DecisionTrace), (c:Concept {name: $conceptName})
        WHERE id(t) = $traceId
        CREATE (t)-[:TAGGED_WITH]->(c)
    """,
    "get_traces_by_concept": """
        MATCH (c:Concept {name: $conceptName})<-[:TAGGED_WITH]-(t:DecisionTrace)
        OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
        OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
        OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
        RETURN t, i, collect(con) AS constraints, a
        ORDER BY t.updatedAt DESC
    """,
    "get_concepts_by_project": """
        MATCH (p:Project {name: $project})<-[:BELONGS_TO_PROJECT]-(t:DecisionTrace)-[:TAGGED_WITH]->(c:Concept)
        RETURN DISTINCT c.name AS name, c.description AS description, count(t) AS traceCount
        ORDER BY traceCount DESC
    """,
}

TOOL_QUERIES = {
    "merge_tool": """
        MERGE (tool:Tool {name: $name})
        ON CREATE SET tool.createdAt = $createdAt
        RETURN id(tool) AS toolId
    """,
    "link_trace_to_tool": """
        MATCH (t:DecisionTrace), (tool:Tool {name: $toolName})
        WHERE id(t) = $traceId
        CREATE (t)-[:USED_TOOL]->(tool)
    """,
    "get_tool_stats_by_project": """
        MATCH (p:Project {name: $project})<-[:BELONGS_TO_PROJECT]-(t:DecisionTrace)-[r:USED_TOOL]->(tool:Tool)
        RETURN tool.name AS toolName, count(r) AS callCount
        ORDER BY callCount DESC
    """,
    "get_tool_stats_by_agent": """
        MATCH (ag:Agent {name: $agentName})<-[:PRODUCED_BY]-(t:DecisionTrace)-[r:USED_TOOL]->(tool:Tool)
        RETURN tool.name AS toolName, count(r) AS callCount
        ORDER BY callCount DESC
    """,
}

SKILL_QUERIES = {
    "merge_skill": """
        MERGE (s:Skill {name: $name})
        ON CREATE SET
            s.description = $description, s.prompt = $prompt,
            s.confidence = $confidence, s.traceCount = $traceCount,
            s.createdAt = $createdAt, s.updatedAt = $updatedAt
        ON MATCH SET
            s.description = $description, s.prompt = $prompt,
            s.confidence = $confidence, s.traceCount = $traceCount,
            s.updatedAt = $updatedAt
        RETURN id(s) AS skillId
    """,
    "link_skill_to_project": """
        MATCH (s:Skill {name: $skillName}), (p:Project {name: $project, tenant: $tenant})
        MERGE (s)-[:BELONGS_TO_PROJECT]->(p)
    """,
    "link_skill_to_concept": """
        MATCH (s:Skill {name: $skillName}), (c:Concept {name: $conceptName})
        MERGE (s)-[:DERIVED_FROM_CONCEPT]->(c)
    """,
    "link_skill_to_domain": """
        MATCH (s:Skill {name: $skillName}), (d:Domain {name: $domain})
        MERGE (s)-[:BELONGS_TO_DOMAIN]->(d)
    """,
    "link_trace_to_skill": """
        MATCH (t:DecisionTrace), (s:Skill {name: $skillName})
        WHERE id(t) = $traceId
        MERGE (t)-[:CONTRIBUTES_TO]->(s)
    """,
    "get_skills_by_project": """
        MATCH (s:Skill)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        OPTIONAL MATCH (s)-[:DERIVED_FROM_CONCEPT]->(c:Concept)
        OPTIONAL MATCH (s)-[:BELONGS_TO_DOMAIN]->(d:Domain)
        RETURN s, collect(DISTINCT c.name) AS concepts, d.name AS domain
        ORDER BY s.confidence DESC
    """,
    "get_skill_by_name": """
        MATCH (s:Skill {name: $name})
        OPTIONAL MATCH (s)-[:DERIVED_FROM_CONCEPT]->(c:Concept)
        OPTIONAL MATCH (s)-[:BELONGS_TO_DOMAIN]->(d:Domain)
        OPTIONAL MATCH (t:DecisionTrace)-[:CONTRIBUTES_TO]->(s)
        OPTIONAL MATCH (t)-[:USED_TOOL]->(tool:Tool)
        RETURN s, collect(DISTINCT c.name) AS concepts, d.name AS domain, collect(DISTINCT tool.name) AS tools
    """,
    "get_synthesized_traces_with_concepts": """
        MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        WHERE t.status = 'synthesized'
        MATCH (t)-[:TAGGED_WITH]->(c:Concept)
        OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
        OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
        OPTIONAL MATCH (t)-[:BELONGS_TO_DOMAIN]->(d:Domain)
        RETURN c.name AS concept, id(t) AS traceId, i.description AS intent, a.description AS action, t.justification_description AS justification, t.justification_confidence AS confidence, d.name AS domain
        ORDER BY concept
    """,
}

# ── Decision Traces ────────────────────────────────────────────────────────────

TRACE_QUERIES = {
    "create_decision_trace": """
        CREATE (t:DecisionTrace {
            name: $trace_name, status: $status,
            justification_description: $justification_description,
            justification_confidence: $justification_confidence,
            justification_ablationScore: $justification_ablationScore,
            embedding: $trace_embedding,
            createdAt: $createdAt, updatedAt: $updatedAt
        })
        CREATE (i:Intent {
            name: $intent_name, description: $intent_description,
            embedding: $intent_embedding, createdAt: $createdAt
        })
        CREATE (a:Action {
            name: $action_name, description: $action_description,
            outcome: $action_outcome, embedding: $action_embedding,
            createdAt: $createdAt
        })
        CREATE (t)-[:HAS_INTENT]->(i)
        CREATE (t)-[:TOOK_ACTION]->(a)
        RETURN id(t) AS traceId
    """,
    "link_trace_to_project": """
        MATCH (t:DecisionTrace), (p:Project {name: $project, tenant: $tenant})
        WHERE id(t) = $traceId
        CREATE (t)-[:BELONGS_TO_PROJECT]->(p)
    """,
    "link_trace_to_domain": """
        MATCH (t:DecisionTrace), (d:Domain {name: $domain})
        WHERE id(t) = $traceId
        CREATE (t)-[:BELONGS_TO_DOMAIN]->(d)
    """,
    "link_trace_to_agent": """
        MATCH (t:DecisionTrace), (ag:Agent {name: $agentName})
        WHERE id(t) = $traceId
        CREATE (t)-[:PRODUCED_BY]->(ag)
    """,
    "create_constraint_for_trace": """
        MATCH (t:DecisionTrace) WHERE id(t) = $traceId
        CREATE (t)-[:HAS_CONSTRAINT]->(con:Constraint {
            name: $name, description: $description, type: $type,
            embedding: $embedding, createdAt: $createdAt
        })
        RETURN id(con) AS constraintId
    """,
    "get_trace_by_id": """
        MATCH (t:DecisionTrace) WHERE id(t) = $traceId
        OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
        OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
        OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
        OPTIONAL MATCH (t)-[:BELONGS_TO_PROJECT]->(p:Project)
        OPTIONAL MATCH (t)-[:BELONGS_TO_DOMAIN]->(d:Domain)
        OPTIONAL MATCH (t)-[:PRODUCED_BY]->(ag:Agent)
        OPTIONAL MATCH (t)-[:TAGGED_WITH]->(c:Concept)
        OPTIONAL MATCH (t)-[tu:USED_TOOL]->(tool:Tool)
        RETURN t, i, collect(DISTINCT con) AS constraints, a, p, d, ag, collect(DISTINCT c) AS concepts, collect(DISTINCT tool.name) AS toolNames
    """,
    "update_trace_status": """
        MATCH (t:DecisionTrace) WHERE id(t) = $traceId
        SET t.status = $status, t.updatedAt = $updatedAt
        RETURN t
    """,
    "update_trace_confidence": """
        MATCH (t:DecisionTrace) WHERE id(t) = $traceId
        SET t.justification_confidence = $confidence, t.updatedAt = $updatedAt
        RETURN t
    """,
    "update_trace_status_and_confidence": """
        MATCH (t:DecisionTrace) WHERE id(t) = $traceId
        SET t.status = $status, t.justification_confidence = $confidence, t.updatedAt = $updatedAt
        RETURN t
    """,
    "get_active_rules": """
        MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        WHERE t.status = 'synthesized'
        OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
        OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
        OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
        RETURN t, i, collect(DISTINCT con) AS constraints, a
        ORDER BY t.justification_confidence DESC
    """,
    "get_active_rules_by_agent": """
        MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        MATCH (t)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
        WHERE t.status = 'synthesized'
        OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
        OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
        OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
        RETURN t, i, collect(DISTINCT con) AS constraints, a
        ORDER BY t.justification_confidence DESC
    """,
    "get_anti_patterns": """
        MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        WHERE t.status = 'anti_pattern'
        OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
        OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
        OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
        RETURN t, i, collect(DISTINCT con) AS constraints, a
        ORDER BY t.updatedAt DESC
    """,
    "get_anti_patterns_by_agent": """
        MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        MATCH (t)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
        WHERE t.status = 'anti_pattern'
        OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
        OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
        OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
        RETURN t, i, collect(DISTINCT con) AS constraints, a
        ORDER BY t.updatedAt DESC
    """,
    "create_precedent_link": """
        MATCH (t1:DecisionTrace), (t2:DecisionTrace)
        WHERE id(t1) = $sourceId AND id(t2) = $targetId
        CREATE (t1)-[r:PRECEDENT_OF]->(t2)
        SET r.similarity = $similarity
    """,
    "count_traces_by_project": """
        MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        RETURN count(t) AS count
    """,
    "get_lifecycle_stats": """
        MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        RETURN t.status AS status, count(t) AS count
    """,
    "get_trace_ids_by_status": """
        MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        WHERE t.status = $status
        RETURN id(t) AS traceId
    """,
    "get_candidates_for_synthesis": """
        MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        WHERE t.status = 'validated' AND t.justification_confidence >= $minConfidence
        OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
        OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
        OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
        RETURN t, i, collect(DISTINCT con) AS constraints, a
    """,
    "get_candidates_for_pruning": """
        MATCH (t:DecisionTrace)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project})
        WHERE t.status = 'validated' AND t.justification_confidence <= $maxConfidence
        RETURN id(t) AS traceId
    """,
}

# ── Vector Search ──────────────────────────────────────────────────────────────


def search_similar_traces_query(vector_literal: str, top_k: int) -> str:
    return f"""
        MATCH (t:DecisionTrace)
          SEARCH t IN (
            VECTOR INDEX trace_embedding
            FOR {vector_literal}
            LIMIT {top_k}
          ) SCORE AS similarity
        OPTIONAL MATCH (t)-[:BELONGS_TO_PROJECT]->(p:Project {{name: $project}})
        WHERE p IS NOT NULL
        OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
        OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
        OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
        OPTIONAL MATCH (t)-[:TAGGED_WITH]->(c:Concept)
        OPTIONAL MATCH (t)-[:PRODUCED_BY]->(ag:Agent)
        RETURN t, i, collect(DISTINCT con) AS constraints, a, similarity, collect(DISTINCT c) AS concepts, ag
        ORDER BY similarity DESC
    """


def search_similar_traces_by_agents_query(
    vector_literal: str, top_k: int, agent_names: list[str]
) -> str:
    agent_filter = ", ".join(f'"{n}"' for n in agent_names)
    return f"""
        MATCH (t:DecisionTrace)
          SEARCH t IN (
            VECTOR INDEX trace_embedding
            FOR {vector_literal}
            LIMIT {top_k}
          ) SCORE AS similarity
        OPTIONAL MATCH (t)-[:BELONGS_TO_PROJECT]->(p:Project {{name: $project}})
        WHERE p IS NOT NULL
        MATCH (t)-[:PRODUCED_BY]->(ag:Agent)
        WHERE ag.name IN [{agent_filter}]
        OPTIONAL MATCH (t)-[:HAS_INTENT]->(i:Intent)
        OPTIONAL MATCH (t)-[:HAS_CONSTRAINT]->(con:Constraint)
        OPTIONAL MATCH (t)-[:TOOK_ACTION]->(a:Action)
        OPTIONAL MATCH (t)-[:TAGGED_WITH]->(c:Concept)
        RETURN t, i, collect(DISTINCT con) AS constraints, a, similarity, collect(DISTINCT c) AS concepts, ag
        ORDER BY similarity DESC
    """
