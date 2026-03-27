import { describe, it, expect, vi } from "vitest";
import {
  ablationFilter,
  filterCriticalFacts,
} from "../../../src/core/ablation-filter.js";
import { createLogger } from "../../../src/utils/logger.js";

const logger = createLogger(false);

function createMockModel(response: string) {
  return {
    invoke: vi.fn().mockResolvedValue({ content: response }),
  } as any;
}

describe("ablationFilter", () => {
  it("should return empty array for empty facts", async () => {
    const model = createMockModel("");
    const results = await ablationFilter([], "decision", model, logger);
    expect(results).toEqual([]);
  });

  it("should parse valid JSON response from observer model", async () => {
    const mockResponse = JSON.stringify({
      evaluations: [
        {
          factIndex: 0,
          wouldChangeDecision: true,
          confidence: 0.9,
          reasoning: "Critical fact",
        },
        {
          factIndex: 1,
          wouldChangeDecision: false,
          confidence: 0.8,
          reasoning: "Not critical",
        },
      ],
    });

    const model = createMockModel(mockResponse);
    const results = await ablationFilter(
      ["Fact A", "Fact B"],
      "Did X",
      model,
      logger
    );

    expect(results).toHaveLength(2);
    expect(results[0].fact).toBe("Fact A");
    expect(results[0].wouldChangeDecision).toBe(true);
    expect(results[0].confidence).toBe(0.9);
    expect(results[1].fact).toBe("Fact B");
    expect(results[1].wouldChangeDecision).toBe(false);
  });

  it("should handle JSON wrapped in markdown code blocks", async () => {
    const mockResponse =
      '```json\n{"evaluations": [{"factIndex": 0, "wouldChangeDecision": true, "confidence": 0.7, "reasoning": "test"}]}\n```';

    const model = createMockModel(mockResponse);
    const results = await ablationFilter(
      ["Fact A"],
      "Decision",
      model,
      logger
    );

    expect(results[0].wouldChangeDecision).toBe(true);
    expect(results[0].confidence).toBe(0.7);
  });

  it("should gracefully handle model errors by keeping all facts", async () => {
    const model = {
      invoke: vi.fn().mockRejectedValue(new Error("Model unavailable")),
    } as any;

    const results = await ablationFilter(
      ["Fact A", "Fact B"],
      "Decision",
      model,
      logger
    );

    expect(results).toHaveLength(2);
    expect(results[0].wouldChangeDecision).toBe(true);
    expect(results[1].wouldChangeDecision).toBe(true);
    expect(results[0].confidence).toBe(0.5);
  });
});

describe("filterCriticalFacts", () => {
  it("should keep only facts that would change the decision", () => {
    const results = [
      { fact: "A", wouldChangeDecision: true, confidence: 0.9 },
      { fact: "B", wouldChangeDecision: false, confidence: 0.8 },
      { fact: "C", wouldChangeDecision: true, confidence: 0.7 },
    ];

    const critical = filterCriticalFacts(results);
    expect(critical).toHaveLength(2);
    expect(critical.map((r) => r.fact)).toEqual(["A", "C"]);
  });

  it("should return empty for all non-critical facts", () => {
    const results = [
      { fact: "A", wouldChangeDecision: false, confidence: 0.9 },
      { fact: "B", wouldChangeDecision: false, confidence: 0.8 },
    ];

    expect(filterCriticalFacts(results)).toHaveLength(0);
  });
});
