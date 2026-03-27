import { describe, it, expect } from "vitest";
import type {
  ContextGraphConfig,
  Intent,
  Constraint,
  Action,
  Justification,
  DecisionTrace,
  TraceStatus,
  UniversalLogicClass,
  ValidationResult,
  LifecycleStats,
  EmbeddingProvider,
} from "../../src/index.js";
import {
  DEFAULT_VECTOR_SEARCH_LIMIT,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_LOGIC_MAPPINGS,
} from "../../src/index.js";

describe("Type definitions", () => {
  it("should have correct default values", () => {
    expect(DEFAULT_VECTOR_SEARCH_LIMIT).toBe(5);
    expect(DEFAULT_SIMILARITY_THRESHOLD).toBe(0.7);
  });

  it("should have default logic mappings covering multiple domains", () => {
    expect(DEFAULT_LOGIC_MAPPINGS.length).toBeGreaterThan(0);

    const domains = new Set(DEFAULT_LOGIC_MAPPINGS.map((m) => m.domain));
    expect(domains).toContain("legal");
    expect(domains).toContain("tech");
    expect(domains).toContain("medical");
    expect(domains).toContain("finance");

    const classes = new Set(
      DEFAULT_LOGIC_MAPPINGS.map((m) => m.universalClass)
    );
    expect(classes).toContain("blocker");
    expect(classes).toContain("permission");
    expect(classes).toContain("pivot");
  });

  it("should allow constructing a valid DecisionTrace", () => {
    const trace: DecisionTrace = {
      id: "1",
      intent: {
        description: "Deploy to production",
        createdAt: new Date().toISOString(),
      },
      constraints: [
        {
          description: "Tests must pass",
          type: "blocker",
          createdAt: new Date().toISOString(),
        },
      ],
      action: {
        description: "Ran CI pipeline",
        outcome: "success",
        createdAt: new Date().toISOString(),
      },
      justification: {
        description: "All tests passed and code review approved",
        confidence: 0.9,
        ablationScore: 0.85,
      },
      project: "my-project",
      tenant: "acme",
      status: "captured",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    expect(trace.intent.description).toBe("Deploy to production");
    expect(trace.constraints).toHaveLength(1);
    expect(trace.justification.confidence).toBe(0.9);
    expect(trace.status).toBe("captured");
  });

  it("should support all TraceStatus values", () => {
    const statuses: TraceStatus[] = [
      "captured",
      "validated",
      "synthesized",
      "anti_pattern",
      "pruned",
    ];
    expect(statuses).toHaveLength(5);
  });

  it("should define EmbeddingProvider interface correctly", () => {
    const mockProvider: EmbeddingProvider = {
      embed: async (text: string) => [0.1, 0.2, 0.3],
      embedBatch: async (texts: string[]) =>
        texts.map(() => [0.1, 0.2, 0.3]),
      dimensions: 3,
    };

    expect(mockProvider.dimensions).toBe(3);
  });
});
