import { describe, it, expect, vi } from "vitest";

// The reasoning extractor creates LangChain middleware, which requires
// integration with a real agent. Here we test the fact extraction and
// classification logic by replicating the internal heuristic functions.
// These match the private functions in reasoning-extractor.ts.

function classifyFact(fact: string): "blocker" | "permission" | "pivot" {
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
}

function extractConceptsFallback(
  intent: string,
  decision: string,
  facts: string[]
): string[] {
  const combined = `${intent} ${decision} ${facts.join(" ")}`.toLowerCase();
  const concepts: string[] = [];
  const patterns: [RegExp, string][] = [
    [/\baccount\s*\w*\s*(lock|block|suspend)|lock\w*\s*(account|out)/i, "account-lockout"],
    [/\bcan'?t\s*(log\s*in|sign\s*in)|login\s*(fail|error|issue)/i, "account-lockout"],
    [/\bpassword\s*\w*\s*(reset|change|forgot)|forgot\w*\s*password/i, "password-reset"],
    [/\brate\s*limit/i, "rate-limiting"],
    [/\b429\b|\btoo many requests/i, "rate-limiting"],
    [/\bbilling|payment|invoice|refund/i, "billing"],
    [/\bapi\s*(key|token|auth)/i, "api-authentication"],
    [/\bescalat/i, "escalation"],
    [/\btimeout|latency|slow/i, "performance"],
    [/\bpermission|rbac|role|access control/i, "access-control"],
    [/\bdeployment|deploy|release/i, "deployment"],
    [/\bbug|defect|regression/i, "bug-fix"],
    [/\brefactor/i, "refactoring"],
    [/\bonboard/i, "onboarding"],
    [/\bmigrat/i, "migration"],
    [/\bdiagnos|symptom|treatment|patient/i, "clinical-decision"],
    [/\bcontract|clause|compliance|regulat/i, "compliance"],
    [/\bliabilit|negligence|statute/i, "legal-risk"],
    [/\bprescri|dosage|medication/i, "medication"],
  ];
  for (const [pattern, tag] of patterns) {
    if (pattern.test(combined) && !concepts.includes(tag)) {
      concepts.push(tag);
    }
  }
  return concepts;
}

function inferDomainFallback(intent: string, decision: string): string {
  const combined = `${intent} ${decision}`.toLowerCase();
  if (/\bapi\b|\bendpoint|\bsdk\b|\brate.?limit|\b429\b/.test(combined)) return "tech";
  if (/\bbilling|\bpayment|\binvoice|\brefund|\bsubscription/.test(combined)) return "finance";
  if (/\baccount|\blogin|\bpassword|\bauth|\block/.test(combined)) return "support";
  if (/\blegal|\bcompliance|\bregulat|\bpolicy|\bcontract|\bliabilit/.test(combined)) return "legal";
  if (/\bmedical|\bpatient|\bdiagnos|\btreatment|\bprescri|\bsymptom/.test(combined)) return "medical";
  return "general";
}

describe("Fact classification (heuristic)", () => {
  it("should classify blocker facts correctly", () => {
    expect(classifyFact("API timeout occurred")).toBe("blocker");
    expect(classifyFact("Request was denied")).toBe("blocker");
    expect(classifyFact("Cannot connect to server")).toBe("blocker");
    expect(classifyFact("Build failed with error")).toBe("blocker");
  });

  it("should classify permission facts correctly", () => {
    expect(classifyFact("User has access to admin panel")).toBe("permission");
    expect(classifyFact("Auth token is valid")).toBe("permission");
    expect(classifyFact("Permission granted to deploy")).toBe("permission");
  });

  it("should classify pivot facts correctly", () => {
    expect(classifyFact("User changed their request")).toBe("pivot");
    expect(classifyFact("The deadline is today")).toBe("pivot");
    expect(classifyFact("Customer is a VIP member")).toBe("pivot");
  });
});

describe("Fact extraction from messages", () => {
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

describe("Concept extraction (heuristic fallback)", () => {
  it("should extract account-lockout concepts", () => {
    const concepts = extractConceptsFallback(
      "My account is locked out",
      "I'll help you unlock your account",
      ["The account was suspended due to failed login attempts"]
    );
    expect(concepts).toContain("account-lockout");
  });

  it("should extract billing concepts", () => {
    const concepts = extractConceptsFallback(
      "I need a refund for my invoice",
      "Processing your refund request",
      []
    );
    expect(concepts).toContain("billing");
  });

  it("should extract api-authentication concepts", () => {
    const concepts = extractConceptsFallback(
      "My API key is not working",
      "Let me check your API token",
      []
    );
    expect(concepts).toContain("api-authentication");
  });

  it("should extract deployment concepts", () => {
    const concepts = extractConceptsFallback(
      "Deploy the latest release",
      "Starting deployment pipeline",
      ["Release v2.0 is ready"]
    );
    expect(concepts).toContain("deployment");
  });

  it("should extract medical concepts", () => {
    const concepts = extractConceptsFallback(
      "Patient reports persistent symptoms",
      "Based on the diagnosis, recommend treatment",
      ["Dosage should be adjusted for the medication"]
    );
    expect(concepts).toContain("clinical-decision");
    expect(concepts).toContain("medication");
  });

  it("should extract legal concepts", () => {
    const concepts = extractConceptsFallback(
      "Review the contract clause for compliance",
      "Checking regulatory requirements",
      ["Potential liability issue identified"]
    );
    expect(concepts).toContain("compliance");
    expect(concepts).toContain("legal-risk");
  });

  it("should return empty array when no patterns match", () => {
    const concepts = extractConceptsFallback(
      "Hello there",
      "Hi, how can I help?",
      []
    );
    expect(concepts).toEqual([]);
  });

  it("should not include duplicate concepts", () => {
    const concepts = extractConceptsFallback(
      "rate limit error, too many requests",
      "429 rate limit hit again",
      ["Rate limiting is enforced"]
    );
    const rateCount = concepts.filter((c) => c === "rate-limiting").length;
    expect(rateCount).toBe(1);
  });
});

describe("Domain inference (heuristic fallback)", () => {
  it("should infer tech domain from API-related content", () => {
    expect(inferDomainFallback("Check the API endpoint", "The SDK returned an error")).toBe("tech");
  });

  it("should infer finance domain from billing content", () => {
    expect(inferDomainFallback("Process a refund", "Invoice has been credited")).toBe("finance");
  });

  it("should infer support domain from account content", () => {
    expect(inferDomainFallback("Reset my password", "Account unlocked")).toBe("support");
  });

  it("should infer legal domain from compliance content", () => {
    expect(inferDomainFallback("Check regulatory compliance", "Policy updated")).toBe("legal");
  });

  it("should infer medical domain from patient content", () => {
    expect(inferDomainFallback("Patient diagnosis", "Prescribe treatment")).toBe("medical");
  });

  it("should default to general when no domain matches", () => {
    expect(inferDomainFallback("Hello world", "Just chatting")).toBe("general");
  });
});
