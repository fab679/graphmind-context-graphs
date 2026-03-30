/**
 * Multi-Agent Shared Context — Cross-Domain Brain Building
 *
 * Three agents (legal, medical, tech) share a project and learn from each other:
 *   - Each agent creates domain-specific entities in the shared graph
 *   - Agents can see each other's decision traces and entities
 *   - Cross-pollination: tech agent inherits knowledge from legal agent's compliance work
 *
 * This demonstrates the "shared context" policy where agents collectively
 * build a unified brain map across domains.
 *
 * Prerequisites:
 *   - Graphmind running: docker run -d -p 8080:8080 fabischk/graphmind:latest
 *   - Environment variables in .env (see .env.example)
 *
 * Usage:
 *   npx tsx examples/multi-agent-shared.ts
 */

import { createAgent, tool } from "langchain";
import { z } from "zod";
import { MemorySaver } from "@langchain/langgraph";
import {
  createContextGraph,
  type ContextSharingPolicy,
  type ContextGraphInstance,
} from "../src/index.js";
import {
  createEmbeddingProvider,
  getModel,
  getObserverModel,
  divider,
  printMessages,
} from "./shared/provider.js";

// ── Config ────────────────────────────────────────────────────────────────────

const TENANT = "enterprise";
const PROJECT = "enterprise-ops";

// ── Domain Tools ──────────────────────────────────────────────────────────────

const review_contract = tool(
  ({ clause }) => {
    const risks: Record<string, string> = {
      liability: "Section 7.2: unlimited liability exposure. Recommend capping at 2x contract value.",
      termination: "30-day notice is standard, but auto-renewal in 9.1 could lock in for 2 years.",
      data: "Data processing clause requires GDPR DPA. Current gap: no data retention policy.",
    };
    const key = Object.keys(risks).find((k) => clause.toLowerCase().includes(k));
    return key ? risks[key] : `No specific risk found for: "${clause}".`;
  },
  {
    name: "review_contract",
    description: "Review a contract clause for risks",
    schema: z.object({ clause: z.string().describe("Contract clause or topic") }),
  }
);

const lookup_patient = tool(
  ({ patientId }) => {
    const patients: Record<string, string> = {
      "PT-001": "John Doe, 45M. Diabetes, hypertension. Meds: Metformin 500mg, Lisinopril 10mg. Allergy: Penicillin.",
    };
    return patients[patientId] ?? `No patient record for ${patientId}.`;
  },
  {
    name: "lookup_patient",
    description: "Look up patient medical history",
    schema: z.object({ patientId: z.string().describe("Patient ID") }),
  }
);

const query_metrics = tool(
  ({ service }) => {
    const metrics: Record<string, string> = {
      "api-gateway": "DEGRADED. P95: 850ms (target: 200ms). Errors: 4.2%. CPU: 89%.",
      "auth-service": "HEALTHY. P95: 45ms. Errors: 0.1%. CPU: 23%.",
    };
    return metrics[service] ?? `No metrics for "${service}".`;
  },
  {
    name: "query_metrics",
    description: "Query system metrics for a service",
    schema: z.object({ service: z.string().describe("Service name") }),
  }
);

// ── Agent Factory ─────────────────────────────────────────────────────────────

async function createDomainAgent(opts: {
  name: string;
  description: string;
  domain: string;
  tools: any[];
  systemPrompt: string;
  sharing: ContextSharingPolicy;
}) {
  const embeddingProvider = await createEmbeddingProvider();

  const cg = await createContextGraph({
    tenant: TENANT,
    project: PROJECT,
    domain: opts.domain,
    agent: opts.name,
    agentDescription: opts.description,
    contextSharing: opts.sharing,
    embedding: {
      provider: embeddingProvider,
      dimensions: embeddingProvider.dimensions,
    },
    observerModel: getObserverModel(),
    baseSystemPrompt: opts.systemPrompt +
      "\n\nYou have brain-mapping tools. Use create_entity and create_relationship to record " +
      "domain knowledge you discover. Use inspect_schema to see what's already mapped.",
    debug: false,
  });

  const agent = createAgent({
    model: getModel(),
    tools: [...opts.tools, ...cg.tools as any[]],
    middleware: cg.middleware as any,
    checkpointer: new MemorySaver(),
  });

  return { agent, cg };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Multi-Agent Shared Context Demo");
  console.log(`Tenant: ${TENANT} | Project: ${PROJECT}\n`);

  // ── 1. Create Agents ────────────────────────────────────────────────────

  divider("1. Creating Domain Agents");

  const { agent: legalAgent, cg: legalCG } = await createDomainAgent({
    name: "legal-agent",
    description: "Reviews contracts and checks compliance",
    domain: "legal",
    tools: [review_contract],
    systemPrompt: "You are a legal advisor AI. Review contracts with precision. Cite specific clauses.",
    sharing: "shared",
  });
  console.log("  Created: legal-agent");

  const { agent: medicalAgent, cg: medicalCG } = await createDomainAgent({
    name: "medical-agent",
    description: "Assists with patient history and clinical decisions",
    domain: "medical",
    tools: [lookup_patient],
    systemPrompt: "You are a clinical decision support AI. Check patient history before recommendations.",
    sharing: "shared",
  });
  console.log("  Created: medical-agent");

  const { agent: techAgent, cg: techCG } = await createDomainAgent({
    name: "tech-agent",
    description: "Monitors system health and diagnoses issues",
    domain: "tech",
    tools: [query_metrics],
    systemPrompt: "You are an SRE AI. Diagnose issues using metrics. Provide actionable fixes.",
    sharing: "shared",
  });
  console.log("  Created: tech-agent");

  // ── 2. Legal Agent — Contract Review ──────────────────────────────────────

  divider("2. Legal Agent — Contract Liability Review");

  const legalResult = await legalAgent.invoke(
    {
      messages: [{
        role: "user",
        content: "Review the liability and data processing clauses in our DataCorp vendor contract. They'll handle EU customer data.",
      }],
    },
    { configurable: { thread_id: "legal-1" } }
  );
  printMessages(legalResult.messages);

  // ── 3. Medical Agent — Patient Consultation ───────────────────────────────

  divider("3. Medical Agent — Patient Review");

  const medicalResult = await medicalAgent.invoke(
    {
      messages: [{
        role: "user",
        content: "Patient PT-001 wants to start Ibuprofen for joint pain. Is this safe given their current medications?",
      }],
    },
    { configurable: { thread_id: "medical-1" } }
  );
  printMessages(medicalResult.messages);

  // ── 4. Tech Agent — System Diagnosis (benefits from shared context) ───────

  divider("4. Tech Agent — API Gateway Diagnosis (with shared context)");
  console.log("The tech agent can see decision traces from legal and medical agents.\n");

  const techResult = await techAgent.invoke(
    {
      messages: [{
        role: "user",
        content: "The api-gateway is showing high latency. Diagnose and recommend fixes.",
      }],
    },
    { configurable: { thread_id: "tech-1" } }
  );
  printMessages(techResult.messages);

  // ── 5. Cross-Domain Statistics ────────────────────────────────────────────

  divider("5. Shared Brain Map Statistics");

  const stats = await legalCG.lifecycle.getLifecycleStats();
  console.log(`Total traces (all agents): ${stats.total}`);

  const agents = await legalCG.store.getAgentsByProject();
  console.log(`\nAgents in "${PROJECT}":`);
  for (const ag of agents) {
    console.log(`  ${ag.name}${ag.description ? ` — ${ag.description}` : ""}`);
  }

  const schema = await legalCG.store.getSchemaOverview();
  console.log("\nEntity types in shared brain map:");
  for (const label of schema.nodeLabels) {
    console.log(`  ${label}: ${schema.nodeCounts[label]} node(s)`);
  }

  const concepts = await legalCG.store.getConceptsByProject();
  if (concepts.length > 0) {
    console.log("\nShared concepts (cross-domain links):");
    for (const c of concepts) {
      console.log(`  #${c.name} — ${c.traceCount} trace(s)`);
    }
  }

  divider("Done!");
  console.log("Three agents now share a unified brain map.");
  console.log("Run again to see cross-domain context injection.\n");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
