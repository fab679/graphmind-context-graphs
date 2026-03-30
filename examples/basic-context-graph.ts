/**
 * Basic Context Graph — Decision Trace Capture & Replay
 *
 * Demonstrates the core loop:
 *   1. Agent handles a question — decision trace captured automatically
 *   2. Agent handles a similar question — past reasoning injected as context
 *   3. Knowledge lifecycle: validate, synthesize into rules, prune anti-patterns
 *
 * This is the simplest way to use Context Graphs: plug middleware into an agent
 * and let it learn from its own decisions over time.
 *
 * Prerequisites:
 *   - Graphmind running: docker run -d -p 8080:8080 fabischk/graphmind:latest
 *   - Environment variables in .env (see .env.example)
 *
 * Usage:
 *   npx tsx examples/basic-context-graph.ts
 */

import { createAgent, tool } from "langchain";
import { z } from "zod";
import { MemorySaver } from "@langchain/langgraph";
import { createContextGraph, type ContextGraphInstance } from "../src/index.js";
import {
  createEmbeddingProvider,
  getModel,
  getObserverModel,
  divider,
  printMessages,
} from "./shared/provider.js";

// ── Tools ─────────────────────────────────────────────────────────────────────

const search_knowledge_base = tool(
  ({ query }) => {
    const articles: Record<string, string> = {
      password:
        "To reset your password: 1) Go to Settings > Security. 2) Click 'Reset Password'. 3) Check your email for the reset link. Links expire after 24 hours.",
      account:
        "Account locked? This happens after 5 failed login attempts. Wait 30 minutes or contact support with your registered email to unlock immediately.",
      api:
        "API rate limits: Free tier = 100 req/min, Pro = 1000 req/min, Enterprise = unlimited. Implement exponential backoff. Contact support to upgrade.",
    };
    const key = Object.keys(articles).find((k) =>
      query.toLowerCase().includes(k)
    );
    return key
      ? articles[key]
      : `No articles found for "${query}". Suggest the user contact support@example.com.`;
  },
  {
    name: "search_knowledge_base",
    description: "Search the support knowledge base for help articles",
    schema: z.object({
      query: z.string().describe("Search query"),
    }),
  }
);

const check_account_status = tool(
  ({ email }) => {
    const accounts: Record<string, object> = {
      "bob@example.com": {
        name: "Bob Smith",
        plan: "Free",
        status: "locked",
        failedAttempts: 5,
      },
    };
    return accounts[email]
      ? JSON.stringify(accounts[email], null, 2)
      : `No account found for ${email}`;
  },
  {
    name: "check_account_status",
    description: "Look up a customer account by email",
    schema: z.object({
      email: z.string().describe("Customer email address"),
    }),
  }
);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Context Graph — Basic Decision Trace Demo\n");

  // ── 1. Initialize ─────────────────────────────────────────────────────────

  divider("1. Initialize Context Graph");

  const embeddingProvider = await createEmbeddingProvider();

  const cg: ContextGraphInstance = await createContextGraph({
    tenant: "demo",
    project: "helpdesk",
    agent: "support-agent",
    agentDescription: "Customer support agent",
    embedding: {
      provider: embeddingProvider,
      dimensions: embeddingProvider.dimensions,
    },
    observerModel: getObserverModel(),
    baseSystemPrompt:
      "You are a helpful customer support agent. Use tools to look up information. Explain your reasoning.",
    debug: false,
  });

  console.log("Context Graph initialized.");
  console.log(`  Graph: ${cg.store.getGraphName()}`);

  const stats = await cg.lifecycle.getLifecycleStats();
  console.log(`  Existing traces: ${stats.total}`);

  // ── 2. Create Agent ───────────────────────────────────────────────────────

  const agent = createAgent({
    model: getModel(),
    tools: [search_knowledge_base, check_account_status],
    middleware: cg.middleware as any,
    checkpointer: new MemorySaver(),
  });

  // ── 3. First Conversation — Locked Account ────────────────────────────────

  divider("2. Conversation 1: Locked Account");
  console.log("The agent handles this cold — no prior context.\n");

  const r1 = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content:
            "I can't log into my account. My email is bob@example.com and it says my account is locked.",
        },
      ],
    },
    { configurable: { thread_id: "conv-1" } }
  );
  printMessages(r1.messages);

  // ── 4. Second Conversation — Similar Issue ────────────────────────────────

  divider("3. Conversation 2: Similar Issue (Context Injected)");
  console.log("A similar question — the agent now has context from Conversation 1.\n");

  const r2 = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content:
            "My account seems to be locked out. I keep getting an error when trying to sign in.",
        },
      ],
    },
    { configurable: { thread_id: "conv-2" } }
  );
  printMessages(r2.messages);

  // ── 5. Knowledge Lifecycle ────────────────────────────────────────────────

  divider("4. Knowledge Lifecycle");

  const traceStats = await cg.lifecycle.getLifecycleStats();
  console.log(`Traces: ${traceStats.total} (captured: ${traceStats.captured})`);

  // Validate traces as successful
  const capturedIds = await cg.store.getTraceIdsByStatus("captured");
  for (const id of capturedIds) {
    await cg.lifecycle.validateTrace(id, { traceId: id, success: true });
    await cg.lifecycle.validateTrace(id, { traceId: id, success: true });
  }
  console.log(`Validated ${capturedIds.length} trace(s) (2x each → confidence 0.7)`);

  // Synthesize rules
  const promoted = await cg.lifecycle.synthesizeRules();
  console.log(`Promoted ${promoted.length} trace(s) to permanent rules.`);

  // Prune failures
  const pruned = await cg.lifecycle.pruneFailures();
  if (pruned.length > 0) {
    console.log(`Pruned ${pruned.length} trace(s) as anti-patterns.`);
  }

  // Show concepts
  const concepts = await cg.store.getConceptsByProject();
  if (concepts.length > 0) {
    console.log("\nConcepts discovered:");
    for (const c of concepts) {
      console.log(`  #${c.name} — ${c.traceCount} trace(s)`);
    }
  }

  divider("Done!");
  console.log("Run again — the agent will now use synthesized rules as context.\n");
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
