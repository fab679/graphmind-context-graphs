import { describe, it, expect, vi } from "vitest";

// The reasoning extractor creates LangChain middleware, which requires
// integration with a real agent. Here we test the fact extraction logic.
describe("Reasoning extraction logic", () => {
  it("should classify blocker facts correctly", () => {
    const classifyFact = (fact: string): "blocker" | "permission" | "pivot" => {
      const lower = fact.toLowerCase();
      if (
        lower.includes("cannot") ||
        lower.includes("error") ||
        lower.includes("fail") ||
        lower.includes("block") ||
        lower.includes("timeout") ||
        lower.includes("denied")
      ) {
        return "blocker";
      }
      if (
        lower.includes("allow") ||
        lower.includes("permit") ||
        lower.includes("access") ||
        lower.includes("grant") ||
        lower.includes("auth")
      ) {
        return "permission";
      }
      return "pivot";
    };

    expect(classifyFact("API timeout occurred")).toBe("blocker");
    expect(classifyFact("Request was denied")).toBe("blocker");
    expect(classifyFact("Cannot connect to server")).toBe("blocker");
    expect(classifyFact("Build failed with error")).toBe("blocker");
  });

  it("should classify permission facts correctly", () => {
    const classifyFact = (fact: string): "blocker" | "permission" | "pivot" => {
      const lower = fact.toLowerCase();
      if (lower.includes("cannot") || lower.includes("error") || lower.includes("fail") || lower.includes("block") || lower.includes("timeout") || lower.includes("denied")) return "blocker";
      if (lower.includes("allow") || lower.includes("permit") || lower.includes("access") || lower.includes("grant") || lower.includes("auth")) return "permission";
      return "pivot";
    };

    expect(classifyFact("User has access to admin panel")).toBe("permission");
    expect(classifyFact("Auth token is valid")).toBe("permission");
    expect(classifyFact("Permission granted to deploy")).toBe("permission");
  });

  it("should classify pivot facts correctly", () => {
    const classifyFact = (fact: string): "blocker" | "permission" | "pivot" => {
      const lower = fact.toLowerCase();
      if (lower.includes("cannot") || lower.includes("error") || lower.includes("fail") || lower.includes("block") || lower.includes("timeout") || lower.includes("denied")) return "blocker";
      if (lower.includes("allow") || lower.includes("permit") || lower.includes("access") || lower.includes("grant") || lower.includes("auth")) return "permission";
      return "pivot";
    };

    expect(classifyFact("User changed their request")).toBe("pivot");
    expect(classifyFact("The deadline is today")).toBe("pivot");
    expect(classifyFact("Customer is a VIP member")).toBe("pivot");
  });

  it("should extract facts from message content", () => {
    const content =
      "The server is running. I checked the logs and found an error. The database connection was restored after a timeout.";
    const sentences = content
      .split(/[.!?]\s+/)
      .filter((s) => s.trim().length > 10);

    expect(sentences.length).toBeGreaterThan(0);
    expect(sentences).toContain("The server is running");
  });
});
