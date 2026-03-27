/**
 * Multi-Domain Agent Demo — Context Graph with Cross-Pollination
 *
 * Demonstrates three agents across different domains (legal, medical, tech)
 * sharing a single project with configurable context sharing policies.
 *
 * Graph structure created:
 *
 *   (Project: enterprise-ops)
 *         ↑ MEMBER_OF        ↑ MEMBER_OF        ↑ MEMBER_OF
 *   (Agent: legal-agent) (Agent: medical-agent) (Agent: tech-agent)
 *         ↓ OPERATES_IN      ↓ OPERATES_IN      ↓ OPERATES_IN
 *   (Domain: legal)     (Domain: medical)     (Domain: tech)
 *
 * Each agent produces DecisionTraces linked via:
 *   PRODUCED_BY → Agent
 *   BELONGS_TO_PROJECT → Project
 *   BELONGS_TO_DOMAIN → Domain
 *   TAGGED_WITH → Concept(s)
 *   USED_TOOL → ToolCall(s)
 *
 * Prerequisites:
 *   - Graphmind running: docker run -d -p 8080:8080 fabischk/graphmind:latest
 *   - Environment variables in .env (see .env.example):
 *       GRAPHMIND_URL, MODEL, EMBEDDING_PROVIDER, EMBEDDING_MODEL, etc.
 *       Plus your provider's API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
 *
 * Usage:
 *   npx tsx examples/multi-domain-agents.ts
 */

import { createAgent, tool } from "langchain";
import { z } from "zod";
import { MemorySaver } from "@langchain/langgraph";
import {
  createContextGraph,
  type ContextSharingPolicy,
} from "../src/index.js";
import {
  createEmbeddingProvider,
  getModel,
  getObserverModel,
  divider,
  printMessages,
} from "./shared/provider.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TENANT = "enterprise_demo";
const PROJECT = "enterprise-ops";

// ── Domain-Specific Tools ────────────────────────────────────────────────────

// Legal tools
const review_contract = tool(
  ({ clause }) => {
    const risks: Record<string, string> = {
      liability: "Section 7.2 contains unlimited liability exposure. Recommend capping at 2x contract value. Similar clauses were flagged in the Acme deal last quarter.",
      termination: "30-day termination notice is standard. However, the auto-renewal clause in 9.1 could lock the company in for 2 additional years.",
      ip: "IP assignment clause transfers all derivative works. This is aggressive — standard practice is to retain pre-existing IP rights.",
      indemnification: "Mutual indemnification is acceptable. However, the carve-out for willful misconduct needs tightening.",
    };
    const key = Object.keys(risks).find((k) => clause.toLowerCase().includes(k));
    return key ? risks[key] : `No specific risk found for clause: "${clause}". Recommend standard legal review.`;
  },
  {
    name: "review_contract",
    description: "Review a contract clause for legal risks and compliance issues",
    schema: z.object({
      clause: z.string().describe("The contract clause or topic to review"),
    }),
  }
);

const check_compliance = tool(
  ({ regulation }) => {
    const rules: Record<string, string> = {
      gdpr: "GDPR compliance: Data processing agreement required. Right to erasure must be implemented within 30 days. Current gap: no data retention policy documented.",
      hipaa: "HIPAA: Business Associate Agreement (BAA) required for any vendor handling PHI. Encryption at rest and in transit mandatory.",
      sox: "SOX compliance: Financial reporting controls adequate. Audit trail logging active. Recommendation: quarterly access reviews.",
    };
    const key = Object.keys(rules).find((k) => regulation.toLowerCase().includes(k));
    return key ? rules[key] : `No compliance framework found for "${regulation}". Consult compliance team.`;
  },
  {
    name: "check_compliance",
    description: "Check compliance status against a specific regulation or framework",
    schema: z.object({
      regulation: z.string().describe("The regulation or compliance framework to check (e.g., GDPR, HIPAA, SOX)"),
    }),
  }
);

// Medical tools
const lookup_patient_history = tool(
  ({ patientId }) => {
    const patients: Record<string, string> = {
      "PT-001": "John Doe, 45M. History: Type 2 diabetes (diagnosed 2020), hypertension. Current meds: Metformin 500mg 2x/day, Lisinopril 10mg. Allergies: Penicillin. Last A1C: 7.2 (2026-02).",
      "PT-002": "Jane Smith, 62F. History: Osteoarthritis, mild anxiety. Current meds: Ibuprofen PRN, Sertraline 50mg. Allergies: None. Recent complaint: increased joint pain in right knee.",
    };
    return patients[patientId] ?? `No patient record found for ${patientId}.`;
  },
  {
    name: "lookup_patient_history",
    description: "Look up a patient's medical history, current medications, and allergies",
    schema: z.object({
      patientId: z.string().describe("The patient's ID (e.g., PT-001)"),
    }),
  }
);

const check_drug_interactions = tool(
  ({ medications }) => {
    const med = medications.toLowerCase();
    if (med.includes("metformin") && med.includes("ibuprofen")) {
      return "WARNING: Metformin + Ibuprofen — NSAIDs can reduce kidney function, increasing risk of metformin-associated lactic acidosis. Monitor renal function closely. Consider Acetaminophen as alternative.";
    }
    if (med.includes("sertraline") && med.includes("ibuprofen")) {
      return "CAUTION: Sertraline + Ibuprofen — Increased risk of GI bleeding. Use lowest effective NSAID dose. Consider gastroprotective agent.";
    }
    return `No significant interactions found for: ${medications}. Standard monitoring recommended.`;
  },
  {
    name: "check_drug_interactions",
    description: "Check for potential drug interactions between medications",
    schema: z.object({
      medications: z.string().describe("Comma-separated list of medications to check"),
    }),
  }
);

// Tech tools
const query_system_metrics = tool(
  ({ service }) => {
    const metrics: Record<string, string> = {
      "api-gateway": "Status: DEGRADED. P95 latency: 850ms (target: 200ms). Error rate: 4.2% (threshold: 1%). CPU: 89%. Memory: 72%. Active connections: 12,450.",
      "auth-service": "Status: HEALTHY. P95 latency: 45ms. Error rate: 0.1%. CPU: 23%. Memory: 45%. Active sessions: 8,200.",
      "payment-service": "Status: HEALTHY. P95 latency: 120ms. Error rate: 0.3%. CPU: 34%. Memory: 55%. Transactions/min: 340.",
    };
    return metrics[service] ?? `No metrics found for service "${service}". Available: api-gateway, auth-service, payment-service.`;
  },
  {
    name: "query_system_metrics",
    description: "Query real-time system metrics for a specific service",
    schema: z.object({
      service: z.string().describe("The service name to query metrics for"),
    }),
  }
);

const run_diagnostic = tool(
  ({ service, check }) => {
    if (service === "api-gateway" && check.includes("latency")) {
      return "Root cause identified: Connection pool exhaustion on api-gateway → payment-service route. Pool size: 50 (configured), 49 active, 1 idle. Recommendation: Increase pool to 200, add circuit breaker with 5s timeout.";
    }
    return `Diagnostic completed for ${service}/${check}. No specific issues found. Consider reviewing recent deployments.`;
  },
  {
    name: "run_diagnostic",
    description: "Run a diagnostic check on a service to identify root causes of issues",
    schema: z.object({
      service: z.string().describe("The service to diagnose"),
      check: z.string().describe("What to check (e.g., 'latency', 'errors', 'memory')"),
    }),
  }
);

// ── Agent Factory ────────────────────────────────────────────────────────────

async function createDomainAgent(opts: {
  agentName: string;
  agentDescription: string;
  domain: string;
  tools: any[];
  systemPrompt: string;
  contextSharing: ContextSharingPolicy;
  allowedAgents?: string[];
}) {
  const embeddingProvider = await createEmbeddingProvider();

  const cg = await createContextGraph({
    tenant: TENANT,
    project: PROJECT,
    domain: opts.domain,
    agent: opts.agentName,
    agentDescription: opts.agentDescription,
    contextSharing: opts.contextSharing,
    allowedAgents: opts.allowedAgents,
    embedding: {
      provider: embeddingProvider,
      dimensions: embeddingProvider.dimensions,
    },
    observerModel: getObserverModel(),
    baseSystemPrompt: opts.systemPrompt,
    debug: false,
  });

  const agent = createAgent({
    model: getModel(),
    tools: opts.tools,
    middleware: cg.middleware as any,
    checkpointer: new MemorySaver(),
  });

  return { agent, contextGraph: cg };
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Multi-Domain Agent Demo — Cross-Pollination via Context Graph");
  console.log(`Tenant: ${TENANT} | Project: ${PROJECT}`);
  console.log("Context sharing: shared (all agents see each other's traces)\n");

  // ── 1. Create Three Domain Agents ──────────────────────────────────────────

  divider("1. Creating Domain Agents");

  const { agent: legalAgent, contextGraph: legalCG } = await createDomainAgent({
    agentName: "legal-agent",
    agentDescription: "Reviews contracts, checks compliance, and identifies legal risks",
    domain: "legal",
    tools: [review_contract, check_compliance],
    systemPrompt: "You are a legal advisor AI. Review contracts and compliance with precision. Always cite the specific clause or regulation. Explain risks in business terms.",
    contextSharing: "shared",
  });
  console.log("  Created: legal-agent (domain: legal)");

  const { agent: medicalAgent, contextGraph: medicalCG } = await createDomainAgent({
    agentName: "medical-agent",
    agentDescription: "Assists with patient history review, drug interactions, and clinical decisions",
    domain: "medical",
    tools: [lookup_patient_history, check_drug_interactions],
    systemPrompt: "You are a clinical decision support AI. Always check patient history and drug interactions before making recommendations. Flag allergies and contraindications clearly.",
    contextSharing: "shared",
  });
  console.log("  Created: medical-agent (domain: medical)");

  const { agent: techAgent, contextGraph: techCG } = await createDomainAgent({
    agentName: "tech-agent",
    agentDescription: "Monitors system health, diagnoses performance issues, and recommends fixes",
    domain: "tech",
    tools: [query_system_metrics, run_diagnostic],
    systemPrompt: "You are a site reliability engineer AI. Diagnose issues using metrics and diagnostics. Provide actionable recommendations with specific configurations.",
    contextSharing: "shared",
  });
  console.log("  Created: tech-agent (domain: tech)");

  const initialStats = await legalCG.lifecycle.getLifecycleStats();
  console.log(`\n  Existing traces in project: ${initialStats.total}`);

  // ── 2. Legal Agent — Contract Review ───────────────────────────────────────

  divider("2. Legal Agent — Contract Liability Review");

  const legalResult = await legalAgent.invoke(
    {
      messages: [{
        role: "user",
        content: "Review the liability clause in our vendor contract with DataCorp. The clause says we assume unlimited liability for data breaches. Is this acceptable?",
      }],
    },
    { configurable: { thread_id: "legal-1" } }
  );
  printMessages(legalResult.messages);

  // ── 3. Medical Agent — Patient Consultation ────────────────────────────────

  divider("3. Medical Agent — Drug Interaction Check");

  const medicalResult = await medicalAgent.invoke(
    {
      messages: [{
        role: "user",
        content: "Patient PT-001 is reporting increased joint pain and wants to start taking Ibuprofen. Is this safe given their current medications?",
      }],
    },
    { configurable: { thread_id: "medical-1" } }
  );
  printMessages(medicalResult.messages);

  // ── 4. Tech Agent — System Diagnosis ───────────────────────────────────────

  divider("4. Tech Agent — API Gateway Diagnosis");

  const techResult = await techAgent.invoke(
    {
      messages: [{
        role: "user",
        content: "The api-gateway is showing high latency and elevated error rates. Can you diagnose the issue and recommend a fix?",
      }],
    },
    { configurable: { thread_id: "tech-1" } }
  );
  printMessages(techResult.messages);

  // ── 5. Legal Agent — Compliance Check (benefits from prior traces) ─────────

  divider("5. Legal Agent — GDPR Compliance (with context from prior traces)");

  const legalResult2 = await legalAgent.invoke(
    {
      messages: [{
        role: "user",
        content: "We need to check our GDPR compliance before the DataCorp contract goes through. They'll be processing EU customer data.",
      }],
    },
    { configurable: { thread_id: "legal-2" } }
  );
  printMessages(legalResult2.messages);

  // ── 6. Medical Agent — Second Patient (cross-pollination) ──────────────────

  divider("6. Medical Agent — Second Patient (with shared context)");

  const medicalResult2 = await medicalAgent.invoke(
    {
      messages: [{
        role: "user",
        content: "Patient PT-002 needs pain management for worsening knee osteoarthritis. What are safe options given their medications?",
      }],
    },
    { configurable: { thread_id: "medical-2" } }
  );
  printMessages(medicalResult2.messages);

  // ── 7. Cross-Domain Statistics ─────────────────────────────────────────────

  divider("7. Cross-Domain Statistics");

  // Use any contextGraph instance — they all share the same project
  const stats = await legalCG.lifecycle.getLifecycleStats();
  console.log("Trace statistics (all agents combined):");
  console.log(`  Captured:      ${stats.captured}`);
  console.log(`  Total:         ${stats.total}`);

  // Agents in project
  const agents = await legalCG.store.getAgentsByProject();
  console.log(`\nAgents in project "${PROJECT}":`);
  for (const ag of agents) {
    console.log(`  ${ag.name}${ag.description ? ` — ${ag.description}` : ""}`);
  }

  // Tool usage across all agents
  const toolStats = await legalCG.store.getToolStats();
  if (toolStats.length > 0) {
    console.log("\nTool usage (all agents):");
    for (const ts of toolStats) {
      console.log(`  ${ts.toolName}: ${ts.callCount} call(s)`);
    }
  }

  // Concepts linking traces across domains
  const concepts = await legalCG.store.getConceptsByProject();
  if (concepts.length > 0) {
    console.log("\nConcepts (cross-domain links):");
    for (const c of concepts) {
      console.log(`  #${c.name} — ${c.traceCount} trace(s)`);
    }
  }

  divider("Done!");
  console.log("The context graph now contains traces from legal, medical, and tech agents.");
  console.log("Run again to see cross-domain context injection in action.\n");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
