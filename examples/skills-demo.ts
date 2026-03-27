/**
 * Skills Demo — Progressive Disclosure with Context Graph
 *
 * Shows the full skill lifecycle:
 *   1. Agent handles several scenarios (traces captured)
 *   2. Validate outcomes (simulate success feedback)
 *   3. Synthesize rules from validated traces
 *   4. Auto-create skills from clustered rules
 *   5. Agent uses load_skill tool to access specialized knowledge on-demand
 *
 * Run this script twice:
 *   - First run: captures traces, validates, synthesizes rules + skills
 *   - Second run: agent discovers and loads skills via progressive disclosure
 *
 * Prerequisites:
 *   - Graphmind running: docker run -d -p 8080:8080 fabischk/graphmind:latest
 *   - Environment variables in .env (see .env.example)
 *
 * Usage:
 *   npx tsx examples/skills-demo.ts
 */

import { createAgent, tool } from "langchain";
import { z } from "zod";
import { MemorySaver } from "@langchain/langgraph";
import {
  createContextGraph,
  createSkillTool,
  createListSkillsTool,
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

const TENANT = "skills_demo";
const PROJECT = "helpdesk";

// ── Tools ─────────────────────────────────────────────────────────────────────

const search_kb = tool(
  ({ query }) => {
    const articles: Record<string, string> = {
      password: "To reset your password: 1) Go to Settings > Security. 2) Click 'Reset Password'. 3) Check your email for the reset link. Links expire after 24 hours.",
      account: "Account locked? This happens after 5 failed login attempts. Wait 30 minutes or contact support with your registered email to unlock immediately.",
      api: "API rate limits: Free tier = 100 req/min, Pro = 1000 req/min, Enterprise = unlimited. Implement exponential backoff. Contact support to upgrade.",
      billing: "Billing issues: Check payment method in Settings > Billing. Ensure card is not expired. Contact billing@example.com for refund requests (5-7 business days).",
    };
    const key = Object.keys(articles).find((k) => query.toLowerCase().includes(k));
    return key ? articles[key] : `No articles found for "${query}".`;
  },
  {
    name: "search_knowledge_base",
    description: "Search the support knowledge base for help articles",
    schema: z.object({ query: z.string().describe("Search query") }),
  }
);

const check_account = tool(
  ({ email }) => {
    const accounts: Record<string, object> = {
      "alice@example.com": { name: "Alice", plan: "Pro", status: "active", failedAttempts: 0 },
      "bob@example.com": { name: "Bob", plan: "Free", status: "locked", failedAttempts: 5 },
      "carol@example.com": { name: "Carol", plan: "Free", status: "locked", failedAttempts: 7 },
      "dave@example.com": { name: "Dave", plan: "Pro", status: "active", failedAttempts: 1 },
    };
    return accounts[email] ? JSON.stringify(accounts[email], null, 2) : `No account found for ${email}`;
  },
  {
    name: "check_account_status",
    description: "Look up a customer account by email",
    schema: z.object({ email: z.string().describe("Customer email address") }),
  }
);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Skills Demo — Progressive Disclosure with Context Graph");
  console.log(`Tenant: ${TENANT} | Project: ${PROJECT}\n`);

  // ── 1. Initialize ──────────────────────────────────────────────────────────

  divider("1. Initializing Context Graph");

  const embeddingProvider = await createEmbeddingProvider();

  const contextGraph: ContextGraphInstance = await createContextGraph({
    tenant: TENANT,
    project: PROJECT,
    domain: "support",
    agent: "support-agent",
    agentDescription: "Customer support agent with skill-based learning",
    embedding: {
      provider: embeddingProvider,
      dimensions: embeddingProvider.dimensions,
    },
    observerModel: getObserverModel(),
    baseSystemPrompt:
      "You are a helpful customer support agent. Use available tools to help customers. " +
      "If a skill is available that matches the customer's issue, load it for expert guidance.",
    debug: false,
  });

  console.log("Context Graph initialized.");
  console.log(`  Graph namespace: ${contextGraph.store.getGraphName()}`);

  const initialStats = await contextGraph.lifecycle.getLifecycleStats();
  console.log(`  Existing traces: ${initialStats.total}`);

  // Check existing skills
  const existingSkills = await contextGraph.store.getSkillsByProject();
  console.log(`  Existing skills: ${existingSkills.length}`);
  for (const s of existingSkills) {
    console.log(`    - ${s.name} (confidence: ${s.confidence.toFixed(2)}, ${s.traceCount} traces)`);
  }

  // ── 2. Create Agent with Skill Tools ───────────────────────────────────────

  const loadSkill = createSkillTool(contextGraph.store);
  const listSkills = createListSkillsTool(contextGraph.store);

  const agent = createAgent({
    model: getModel(),
    tools: [search_kb, check_account, loadSkill, listSkills],
    middleware: contextGraph.middleware as any,
    checkpointer: new MemorySaver(),
  });

  // ── 3. Handle Multiple Scenarios ───────────────────────────────────────────

  const scenarios = [
    {
      title: "Locked Account (Bob)",
      message: "Hi, my email is bob@example.com and my account is locked. Can you help?",
    },
    {
      title: "Another Locked Account (Carol)",
      message: "I can't sign in, I think my account got locked after too many wrong passwords. My email is carol@example.com.",
    },
    {
      title: "Password Reset",
      message: "I forgot my password. How do I reset it?",
    },
    {
      title: "API Rate Limits",
      message: "I'm hitting 429 errors on the free tier. What are my options?",
    },
  ];

  for (let i = 0; i < scenarios.length; i++) {
    divider(`${i + 2}. ${scenarios[i].title}`);
    const result = await agent.invoke(
      { messages: [{ role: "user", content: scenarios[i].message }] },
      { configurable: { thread_id: `skills-demo-${i}` } }
    );
    printMessages(result.messages);
  }

  // ── 4. Validate All Traces as Successful ───────────────────────────────────

  divider(`${scenarios.length + 2}. Validating Traces`);

  const stats = await contextGraph.lifecycle.getLifecycleStats();
  console.log(`Traces before validation: ${stats.total} (captured: ${stats.captured})`);

  // Simulate: all conversations resolved the issue successfully — twice each.
  // Initial confidence is 0.5 (discovery mode). Each success adds +0.1.
  // Two validations → 0.5 → 0.6 → 0.7, which meets the synthesis threshold.
  // In production, this happens naturally over time as outcomes are observed.
  // Gather both captured and already-validated traces (re-validating boosts confidence)
  const capturedIds = await contextGraph.store.getTraceIdsByStatus("captured");
  const validatedIds = await contextGraph.store.getTraceIdsByStatus("validated");
  const allIds = [...capturedIds, ...validatedIds];
  if (allIds.length > 0) {
    console.log(`Validating ${allIds.length} trace(s) as successful (x2 each)...`);
    for (const traceId of allIds) {
      // First validation: captured → validated (confidence 0.5 → 0.6)
      await contextGraph.lifecycle.validateTrace(traceId, {
        traceId,
        success: true,
        feedback: "Issue resolved successfully",
      });
      // Second validation: confidence 0.6 → 0.7 (meets synthesis threshold)
      await contextGraph.lifecycle.validateTrace(traceId, {
        traceId,
        success: true,
        feedback: "Confirmed resolution",
      });
    }
    console.log("All traces validated (confidence >= 0.7).");
  } else {
    console.log("No captured traces to validate.");
  }

  // ── 5. Synthesize Rules + Skills ───────────────────────────────────────────

  divider(`${scenarios.length + 3}. Synthesizing Rules & Skills`);

  const promoted = await contextGraph.lifecycle.synthesizeRules();
  console.log(`Promoted ${promoted.length} trace(s) to rules.`);

  const skillNames = await contextGraph.lifecycle.synthesizeSkills();
  console.log(`Auto-created ${skillNames.length} skill(s):`);
  for (const name of skillNames) {
    const skill = await contextGraph.store.getSkillByName(name);
    if (skill) {
      console.log(`  - ${skill.name} (confidence: ${skill.confidence.toFixed(2)}, ${skill.traceCount} traces)`);
      console.log(`    Concepts: ${skill.concepts.map((c) => `#${c}`).join(", ")}`);
      if (skill.tools.length > 0) {
        console.log(`    Tools: ${skill.tools.join(", ")}`);
      }
    }
  }

  const pruned = await contextGraph.lifecycle.pruneFailures();
  if (pruned.length > 0) {
    console.log(`Pruned ${pruned.length} trace(s) as anti-patterns.`);
  }

  // ── 6. Agent Uses Skills ───────────────────────────────────────────────────

  divider(`${scenarios.length + 4}. Agent with Skills (Progressive Disclosure)`);

  const updatedSkills = await contextGraph.store.getSkillsByProject();
  if (updatedSkills.length > 0) {
    console.log("Skills now available to the agent:");
    for (const s of updatedSkills) {
      console.log(`  - ${s.name}: ${s.description}`);
    }
    console.log("");

    // Run a new conversation — agent should discover and use skills
    console.log("New conversation: another locked account...\n");
    const skillResult = await agent.invoke(
      {
        messages: [{
          role: "user",
          content: "My account seems to be locked. What should I do?",
        }],
      },
      { configurable: { thread_id: "skills-demo-with-skill" } }
    );
    printMessages(skillResult.messages);
  } else {
    console.log("No skills created yet. Run this script again after traces are validated.");
    console.log("Skills require 2+ synthesized traces sharing a concept tag.");
  }

  // ── 7. Final Stats ─────────────────────────────────────────────────────────

  divider(`${scenarios.length + 5}. Final Statistics`);

  const finalStats = await contextGraph.lifecycle.getLifecycleStats();
  console.log(`Total traces:  ${finalStats.total}`);
  console.log(`  Captured:    ${finalStats.captured}`);
  console.log(`  Validated:   ${finalStats.validated}`);
  console.log(`  Synthesized: ${finalStats.synthesized}`);
  console.log(`  Anti-patterns: ${finalStats.antiPatterns}`);

  const finalSkills = await contextGraph.store.getSkillsByProject();
  console.log(`\nSkills: ${finalSkills.length}`);
  for (const s of finalSkills) {
    console.log(`  - ${s.name} (${s.traceCount} traces, confidence: ${s.confidence.toFixed(2)})`);
  }

  const concepts = await contextGraph.store.getConceptsByProject();
  if (concepts.length > 0) {
    console.log(`\nConcepts:`);
    for (const c of concepts) {
      console.log(`  #${c.name} — ${c.traceCount} trace(s)`);
    }
  }

  const toolStats = await contextGraph.store.getToolStats();
  if (toolStats.length > 0) {
    console.log(`\nTool usage:`);
    for (const ts of toolStats) {
      console.log(`  ${ts.toolName}: ${ts.callCount} call(s)`);
    }
  }

  divider("Done!");
  console.log("Run this script again — the agent will now use skills for expert guidance.\n");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
