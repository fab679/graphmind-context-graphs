import { describe, it, expect } from "vitest";
import {
  TRACE_QUERIES,
  VECTOR_QUERIES,
  SCHEMA_QUERIES,
  PROJECT_QUERIES,
  DOMAIN_QUERIES,
  CONCEPT_QUERIES,
  AGENT_QUERIES,
  TOOL_QUERIES,
  SKILL_QUERIES,
} from "../../../src/db/queries.js";

describe("Cypher query builders", () => {
  describe("SCHEMA_QUERIES", () => {
    it("should generate vector index creation with correct dimensions", () => {
      const query = SCHEMA_QUERIES.createIntentVectorIndex(1536, "cosine");
      expect(query).toContain("CREATE VECTOR INDEX");
      expect(query).toContain("FOR (n:Intent) ON (n.embedding)");
      expect(query).toContain("dimensions: 1536");
      expect(query).toContain("similarity: 'cosine'");
    });

    it("should generate trace vector index with l2 metric", () => {
      const query = SCHEMA_QUERIES.createTraceVectorIndex(384, "l2");
      expect(query).toContain("FOR (n:DecisionTrace) ON (n.embedding)");
      expect(query).toContain("dimensions: 384");
      expect(query).toContain("similarity: 'l2'");
    });

    it("should generate concept vector index", () => {
      const query = SCHEMA_QUERIES.createConceptVectorIndex(1536, "cosine");
      expect(query).toContain("FOR (n:Concept) ON (n.embedding)");
      expect(query).toContain("dimensions: 1536");
    });

    it("should have property indexes for Project, Domain, Concept, ToolCall, and Agent", () => {
      expect(SCHEMA_QUERIES.createProjectIndex).toContain(":Project");
      expect(SCHEMA_QUERIES.createDomainIndex).toContain(":Domain");
      expect(SCHEMA_QUERIES.createConceptIndex).toContain(":Concept");
      expect(SCHEMA_QUERIES.createToolIndex).toContain(":Tool");
      expect(SCHEMA_QUERIES.createAgentIndex).toContain(":Agent");
    });
  });

  describe("TRACE_QUERIES", () => {
    it("should have parameterized createDecisionTrace query without domain property", () => {
      expect(TRACE_QUERIES.createDecisionTrace).toContain("$status");
      expect(TRACE_QUERIES.createDecisionTrace).toContain("$justification_description");
      expect(TRACE_QUERIES.createDecisionTrace).toContain("CREATE (t:DecisionTrace");
      expect(TRACE_QUERIES.createDecisionTrace).toContain("CREATE (i:Intent");
      expect(TRACE_QUERIES.createDecisionTrace).toContain("CREATE (a:Action");
      expect(TRACE_QUERIES.createDecisionTrace).toContain("CREATE (t)-[:HAS_INTENT]->(i)");
      expect(TRACE_QUERIES.createDecisionTrace).toContain("CREATE (t)-[:TOOK_ACTION]->(a)");
      // Domain should NOT be a property on trace/intent/action nodes
      expect(TRACE_QUERIES.createDecisionTrace).not.toContain("domain:");
      expect(TRACE_QUERIES.createDecisionTrace).not.toContain("$domain");
    });

    it("should link traces to Project, Domain, and Agent via separate queries", () => {
      expect(TRACE_QUERIES.linkTraceToProject).toContain("BELONGS_TO_PROJECT");
      expect(TRACE_QUERIES.linkTraceToProject).toContain("$project");
      expect(TRACE_QUERIES.linkTraceToProject).toContain("$tenant");
      expect(TRACE_QUERIES.linkTraceToDomain).toContain("BELONGS_TO_DOMAIN");
      expect(TRACE_QUERIES.linkTraceToDomain).toContain("$domain");
      expect(TRACE_QUERIES.linkTraceToAgent).toContain("PRODUCED_BY");
      expect(TRACE_QUERIES.linkTraceToAgent).toContain("$agentName");
    });

    it("should have parameterized getTraceById with extended nodes including Agent and Tool", () => {
      expect(TRACE_QUERIES.getTraceById).toContain("$traceId");
      expect(TRACE_QUERIES.getTraceById).toContain("BELONGS_TO_PROJECT");
      expect(TRACE_QUERIES.getTraceById).toContain("BELONGS_TO_DOMAIN");
      expect(TRACE_QUERIES.getTraceById).toContain("PRODUCED_BY");
      expect(TRACE_QUERIES.getTraceById).toContain("TAGGED_WITH");
      expect(TRACE_QUERIES.getTraceById).toContain("USED_TOOL");
    });

    it("should have agent-scoped rule queries", () => {
      expect(TRACE_QUERIES.getActiveRulesByAgent).toContain("$agentName");
      expect(TRACE_QUERIES.getActiveRulesByAgent).toContain("PRODUCED_BY");
      expect(TRACE_QUERIES.getActiveRulesByAgent).toContain("'synthesized'");
      expect(TRACE_QUERIES.getAntiPatternsByAgent).toContain("$agentName");
      expect(TRACE_QUERIES.getAntiPatternsByAgent).toContain("PRODUCED_BY");
    });

    it("should have agent-scoped trace count query", () => {
      expect(TRACE_QUERIES.countTracesByAgent).toContain("$agentName");
      expect(TRACE_QUERIES.countTracesByAgent).toContain("PRODUCED_BY");
    });

    it("should have parameterized updateTraceStatus query", () => {
      expect(TRACE_QUERIES.updateTraceStatus).toContain("$traceId");
      expect(TRACE_QUERIES.updateTraceStatus).toContain("$status");
      expect(TRACE_QUERIES.updateTraceStatus).toContain("$updatedAt");
    });

    it("should filter active rules by project and synthesized status", () => {
      expect(TRACE_QUERIES.getActiveRules).toContain("$project");
      expect(TRACE_QUERIES.getActiveRules).toContain("'synthesized'");
    });

    it("should filter anti-patterns by project and anti_pattern status", () => {
      expect(TRACE_QUERIES.getAntiPatterns).toContain("$project");
      expect(TRACE_QUERIES.getAntiPatterns).toContain("'anti_pattern'");
    });

    it("should create constraints inline from matched trace", () => {
      expect(TRACE_QUERIES.createConstraintForTrace).toContain("HAS_CONSTRAINT");
      expect(TRACE_QUERIES.createConstraintForTrace).toContain(":Constraint");
      expect(TRACE_QUERIES.createConstraintForTrace).toContain("$traceId");
      expect(TRACE_QUERIES.createConstraintForTrace).toContain("$description");
      expect(TRACE_QUERIES.createConstraintForTrace).not.toContain("domain:");
    });
  });

  describe("PROJECT_QUERIES", () => {
    it("should have merge queries with tenant scoping", () => {
      expect(PROJECT_QUERIES.mergeProject).toContain("MERGE");
      expect(PROJECT_QUERIES.mergeProject).toContain(":Project");
      expect(PROJECT_QUERIES.mergeProject).toContain("$name");
      expect(PROJECT_QUERIES.mergeProject).toContain("$tenant");
      expect(PROJECT_QUERIES.mergeProjectSimple).toContain("MERGE");
      expect(PROJECT_QUERIES.mergeProjectSimple).toContain(":Project");
    });
  });

  describe("DOMAIN_QUERIES", () => {
    it("should have merge queries by name", () => {
      expect(DOMAIN_QUERIES.mergeDomain).toContain("MERGE");
      expect(DOMAIN_QUERIES.mergeDomain).toContain(":Domain");
      expect(DOMAIN_QUERIES.mergeDomain).toContain("$name");
      expect(DOMAIN_QUERIES.mergeDomainSimple).toContain("MERGE");
      expect(DOMAIN_QUERIES.mergeDomainSimple).toContain(":Domain");
    });
  });

  describe("AGENT_QUERIES", () => {
    it("should have merge queries by name", () => {
      expect(AGENT_QUERIES.mergeAgent).toContain("MERGE");
      expect(AGENT_QUERIES.mergeAgent).toContain(":Agent");
      expect(AGENT_QUERIES.mergeAgent).toContain("$name");
      expect(AGENT_QUERIES.mergeAgentSimple).toContain("MERGE");
      expect(AGENT_QUERIES.mergeAgentSimple).toContain(":Agent");
    });

    it("should link agent to project", () => {
      expect(AGENT_QUERIES.linkAgentToProject).toContain("MEMBER_OF");
      expect(AGENT_QUERIES.linkAgentToProject).toContain("$agentName");
      expect(AGENT_QUERIES.linkAgentToProject).toContain("$project");
    });

    it("should link agent to domain", () => {
      expect(AGENT_QUERIES.linkAgentToDomain).toContain("OPERATES_IN");
      expect(AGENT_QUERIES.linkAgentToDomain).toContain("$agentName");
      expect(AGENT_QUERIES.linkAgentToDomain).toContain("$domain");
    });

    it("should get agents by project", () => {
      expect(AGENT_QUERIES.getAgentsByProject).toContain("MEMBER_OF");
      expect(AGENT_QUERIES.getAgentsByProject).toContain("$project");
    });
  });

  describe("TOOL_QUERIES", () => {
    it("should have merge Tool query and link to trace", () => {
      expect(TOOL_QUERIES.mergeTool).toContain("MERGE");
      expect(TOOL_QUERIES.mergeTool).toContain(":Tool");
      expect(TOOL_QUERIES.linkTraceToTool).toContain("USED_TOOL");
      expect(TOOL_QUERIES.linkTraceToTool).toContain("$toolName");
      expect(TOOL_QUERIES.linkTraceToTool).toContain("$traceId");
    });

    it("should get tool stats by project", () => {
      expect(TOOL_QUERIES.getToolStatsByProject).toContain("USED_TOOL");
      expect(TOOL_QUERIES.getToolStatsByProject).toContain("$project");
      expect(TOOL_QUERIES.getToolStatsByProject).toContain("count(r)");
    });

    it("should get tool stats by agent", () => {
      expect(TOOL_QUERIES.getToolStatsByAgent).toContain("PRODUCED_BY");
      expect(TOOL_QUERIES.getToolStatsByAgent).toContain("$agentName");
    });
  });

  describe("CONCEPT_QUERIES", () => {
    it("should have merge concept queries", () => {
      expect(CONCEPT_QUERIES.mergeConcept).toContain("MERGE");
      expect(CONCEPT_QUERIES.mergeConcept).toContain(":Concept");
      expect(CONCEPT_QUERIES.mergeConcept).toContain("$name");
      expect(CONCEPT_QUERIES.mergeConceptSimple).toContain("MERGE");
      expect(CONCEPT_QUERIES.mergeConceptSimple).toContain(":Concept");
    });

    it("should link traces to concepts", () => {
      expect(CONCEPT_QUERIES.linkTraceToConcept).toContain("TAGGED_WITH");
      expect(CONCEPT_QUERIES.linkTraceToConcept).toContain("$traceId");
      expect(CONCEPT_QUERIES.linkTraceToConcept).toContain("$conceptName");
    });

    it("should query traces by concept", () => {
      expect(CONCEPT_QUERIES.getTracesByConcept).toContain("TAGGED_WITH");
      expect(CONCEPT_QUERIES.getTracesByConcept).toContain("$conceptName");
    });
  });

  describe("VECTOR_QUERIES", () => {
    it("should generate SEARCH clause with inline vector literal and correct limit", () => {
      const vector = "[0.1, 0.2, 0.3]";
      const query = VECTOR_QUERIES.searchSimilarTraces(vector, 10);
      expect(query).toContain("SEARCH t IN");
      expect(query).toContain("VECTOR INDEX trace_embedding");
      expect(query).toContain(`FOR ${vector}`);
      expect(query).toContain("LIMIT 10");
      expect(query).toContain("SCORE AS similarity");
      expect(query).toContain("$project");
      expect(query).not.toContain("$queryVector");
    });

    it("should include agent traversal in trace search", () => {
      const query = VECTOR_QUERIES.searchSimilarTraces("[1, 2, 3]", 5);
      expect(query).toContain("PRODUCED_BY");
      expect(query).toContain("Agent");
    });

    it("should generate agent-scoped search with agent name filter", () => {
      const query = VECTOR_QUERIES.searchSimilarTracesByAgents(
        "[0.1, 0.2]", 5, ["support-agent", "legal-agent"]
      );
      expect(query).toContain("PRODUCED_BY");
      expect(query).toContain('"support-agent"');
      expect(query).toContain('"legal-agent"');
    });

    it("should include graph traversal for full trace reconstruction", () => {
      const query = VECTOR_QUERIES.searchSimilarTraces("[1, 2, 3]", 5);
      expect(query).toContain("HAS_INTENT");
      expect(query).toContain("HAS_CONSTRAINT");
      expect(query).toContain("TOOK_ACTION");
    });

    it("should generate concept search with inline vector and named index", () => {
      const vector = "[0.5, 0.6]";
      const query = VECTOR_QUERIES.searchSimilarConcepts(vector, 3);
      expect(query).toContain("VECTOR INDEX concept_embedding");
      expect(query).toContain(`FOR ${vector}`);
      expect(query).toContain("LIMIT 3");
      expect(query).not.toContain("$queryVector");
    });
  });
});
