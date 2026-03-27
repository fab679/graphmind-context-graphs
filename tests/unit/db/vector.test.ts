import { describe, it, expect } from "vitest";
import { VECTOR_QUERIES } from "../../../src/db/queries.js";

describe("Vector search", () => {
  const sampleVector = "[0.1, 0.2, 0.3]";

  it("should generate valid SEARCH clause with inline vector literal", () => {
    const query = VECTOR_QUERIES.searchSimilarTraces(sampleVector, 5);

    // Verify it follows Graphmind SEARCH clause format
    expect(query).toMatch(/MATCH\s+\(t:DecisionTrace\)/);
    expect(query).toMatch(/SEARCH\s+t\s+IN/);
    expect(query).toContain("VECTOR INDEX trace_embedding");
    expect(query).toContain(`FOR ${sampleVector}`);
    expect(query).toMatch(/LIMIT\s+5/);
    expect(query).toMatch(/SCORE\s+AS\s+similarity/);
    // Must NOT use $queryVector — Graphmind requires inline literals
    expect(query).not.toContain("$queryVector");
  });

  it("should include project filter via BELONGS_TO_PROJECT traversal", () => {
    const query = VECTOR_QUERIES.searchSimilarTraces(sampleVector, 10);
    expect(query).toContain("BELONGS_TO_PROJECT");
    expect(query).toContain("$project");
  });

  it("should order results by similarity descending", () => {
    const query = VECTOR_QUERIES.searchSimilarTraces(sampleVector, 5);
    expect(query).toContain("ORDER BY similarity DESC");
  });

  it("should use different limits for different k values", () => {
    const q3 = VECTOR_QUERIES.searchSimilarTraces(sampleVector, 3);
    const q20 = VECTOR_QUERIES.searchSimilarTraces(sampleVector, 20);
    expect(q3).toContain("LIMIT 3");
    expect(q20).toContain("LIMIT 20");
  });

  it("should include concept traversal in results", () => {
    const query = VECTOR_QUERIES.searchSimilarTraces(sampleVector, 5);
    expect(query).toContain("TAGGED_WITH");
  });

  it("should use named concept_embedding index for concept search", () => {
    const query = VECTOR_QUERIES.searchSimilarConcepts(sampleVector, 3);
    expect(query).toContain("VECTOR INDEX concept_embedding");
    expect(query).toContain(`FOR ${sampleVector}`);
    expect(query).not.toContain("$queryVector");
  });
});
