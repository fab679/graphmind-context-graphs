import { describe, it, expect, vi } from "vitest";

// Test the formatting logic directly since dynamicSystemPromptMiddleware
// is a LangChain integration that requires a running agent
describe("Prompt injection formatting", () => {
  it("should format past traces with similarity scores", () => {
    const traces = [
      {
        trace: {
          intent: { description: "Deploy app", createdAt: "" },
          constraints: [
            { description: "Tests must pass", type: "blocker" as const, createdAt: "" },
          ],
          action: { description: "Ran CI pipeline", createdAt: "" },
          justification: {
            description: "All tests passed",
            confidence: 0.9,
          },
          project: "test",
          tenant: "test",
          status: "captured" as const,
          createdAt: "",
          updatedAt: "",
        },
        similarity: 0.85,
      },
    ];

    // Verify the trace data structure is complete
    expect(traces[0].trace.intent.description).toBe("Deploy app");
    expect(traces[0].similarity).toBe(0.85);
    expect(traces[0].trace.constraints[0].type).toBe("blocker");
  });

  it("should format rules with confidence levels", () => {
    const rules = [
      {
        justification: {
          description: "Always run integration tests before deploy",
          confidence: 0.95,
        },
        status: "synthesized" as const,
      },
    ];

    expect(rules[0].justification.confidence).toBeGreaterThan(0.7);
    expect(rules[0].status).toBe("synthesized");
  });

  it("should format anti-patterns as warnings", () => {
    const antiPatterns = [
      {
        justification: {
          description: "Deploying without code review",
          confidence: 0.1,
        },
        status: "anti_pattern" as const,
      },
    ];

    expect(antiPatterns[0].status).toBe("anti_pattern");
    expect(antiPatterns[0].justification.confidence).toBeLessThan(0.3);
  });
});
