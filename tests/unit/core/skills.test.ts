import { describe, it, expect } from "vitest";
import { SKILL_QUERIES, SCHEMA_QUERIES } from "../../../src/db/queries.js";

describe("Skills", () => {
  describe("SCHEMA_QUERIES", () => {
    it("should have a Skill property index", () => {
      expect(SCHEMA_QUERIES.createSkillIndex).toContain(":Skill");
      expect(SCHEMA_QUERIES.createSkillIndex).toContain("n.name");
    });
  });

  describe("SKILL_QUERIES", () => {
    it("should merge a skill by name with all properties", () => {
      expect(SKILL_QUERIES.mergeSkill).toContain("MERGE");
      expect(SKILL_QUERIES.mergeSkill).toContain(":Skill");
      expect(SKILL_QUERIES.mergeSkill).toContain("$name");
      expect(SKILL_QUERIES.mergeSkill).toContain("$prompt");
      expect(SKILL_QUERIES.mergeSkill).toContain("$confidence");
      expect(SKILL_QUERIES.mergeSkill).toContain("$traceCount");
      expect(SKILL_QUERIES.mergeSkill).toContain("ON CREATE SET");
      expect(SKILL_QUERIES.mergeSkill).toContain("ON MATCH SET");
    });

    it("should link skill to project", () => {
      expect(SKILL_QUERIES.linkSkillToProject).toContain("BELONGS_TO_PROJECT");
      expect(SKILL_QUERIES.linkSkillToProject).toContain("$skillName");
      expect(SKILL_QUERIES.linkSkillToProject).toContain("$project");
    });

    it("should link skill to concept via DERIVED_FROM_CONCEPT", () => {
      expect(SKILL_QUERIES.linkSkillToConcept).toContain("DERIVED_FROM_CONCEPT");
      expect(SKILL_QUERIES.linkSkillToConcept).toContain("$skillName");
      expect(SKILL_QUERIES.linkSkillToConcept).toContain("$conceptName");
    });

    it("should link skill to domain", () => {
      expect(SKILL_QUERIES.linkSkillToDomain).toContain("BELONGS_TO_DOMAIN");
      expect(SKILL_QUERIES.linkSkillToDomain).toContain("$skillName");
      expect(SKILL_QUERIES.linkSkillToDomain).toContain("$domain");
    });

    it("should link traces to skills via CONTRIBUTES_TO", () => {
      expect(SKILL_QUERIES.linkTraceToSkill).toContain("CONTRIBUTES_TO");
      expect(SKILL_QUERIES.linkTraceToSkill).toContain("$traceId");
      expect(SKILL_QUERIES.linkTraceToSkill).toContain("$skillName");
    });

    it("should get skills by project with concepts and domain", () => {
      expect(SKILL_QUERIES.getSkillsByProject).toContain("BELONGS_TO_PROJECT");
      expect(SKILL_QUERIES.getSkillsByProject).toContain("$project");
      expect(SKILL_QUERIES.getSkillsByProject).toContain("DERIVED_FROM_CONCEPT");
      expect(SKILL_QUERIES.getSkillsByProject).toContain("BELONGS_TO_DOMAIN");
    });

    it("should get skill by name with tools", () => {
      expect(SKILL_QUERIES.getSkillByName).toContain("$name");
      expect(SKILL_QUERIES.getSkillByName).toContain("DERIVED_FROM_CONCEPT");
      expect(SKILL_QUERIES.getSkillByName).toContain("USED_TOOL");
    });

    it("should group synthesized traces by concept for auto-skill creation", () => {
      expect(SKILL_QUERIES.getSynthesizedTracesByConcept).toContain("'synthesized'");
      expect(SKILL_QUERIES.getSynthesizedTracesByConcept).toContain("TAGGED_WITH");
      expect(SKILL_QUERIES.getSynthesizedTracesByConcept).toContain("$project");
    });
  });
});
