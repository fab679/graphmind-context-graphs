/**
 * Graphmind Context Graph - Live Agent Demo
 *
 * This script creates a LangChain agent with Context Graph middleware and runs
 * it through two conversations to demonstrate:
 *
 *   1. Decision trace capture (first run)
 *   2. Context injection from past reasoning (second run)
 *   3. Knowledge lifecycle (validate, synthesize)
 *
 * Prerequisites:
 *   - Graphmind running: docker run -d -p 8080:8080 fabischk/graphmind:latest
 *   - Environment variables in .env (see .env.example):
 *       GRAPHMIND_URL, MODEL, EMBEDDING_PROVIDER, EMBEDDING_MODEL, etc.
 *       Plus your provider's API key (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.)
 *
 * Usage:
 *   npx tsx examples/run-agent.ts
 */

import { createAgent, tool } from "langchain";
import { z } from "zod";
import { MemorySaver } from "@langchain/langgraph";
import {
  createContextGraph,
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

// No need to manually load dotenv — createContextGraph() does it automatically.
// Configure provider/model via .env (see .env.example) or environment variables.
const TENANT = "demo_tenant";
const PROJECT = "helpdesk";

// ── Tools ─────────────────────────────────────────────────────────────────────

const search_knowledge_base = tool(
  ({ query }) => {
    // Simulated knowledge base
    const articles: Record<string, string> = {
      password:
        "To reset your password: 1) Go to Settings > Security. 2) Click 'Reset Password'. 3) Check your email for the reset link. Note: Links expire after 24 hours.",
      billing:
        "Billing issues: 1) Check your payment method in Settings > Billing. 2) Ensure card is not expired. 3) Contact billing@example.com for refund requests. Refunds take 5-7 business days.",
      api:
        "API rate limits: Free tier = 100 req/min, Pro = 1000 req/min, Enterprise = unlimited. If you hit rate limits, implement exponential backoff. Contact support to upgrade.",
      account:
        "Account locked? This happens after 5 failed login attempts. Wait 30 minutes or contact support with your registered email to unlock immediately.",
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
    description:
      "Search the support knowledge base for help articles matching the query",
    schema: z.object({
      query: z.string().describe("The search query to find relevant articles"),
    }),
  }
);

const check_account_status = tool(
  ({ email }) => {
    // Simulated account lookup
    const accounts: Record<string, object> = {
      "alice@example.com": {
        name: "Alice Johnson",
        plan: "Pro",
        status: "active",
        lastLogin: "2026-03-26",
        failedAttempts: 0,
      },
      "bob@example.com": {
        name: "Bob Smith",
        plan: "Free",
        status: "locked",
        lastLogin: "2026-03-20",
        failedAttempts: 5,
      },
    };

    const account = accounts[email];
    return account
      ? JSON.stringify(account, null, 2)
      : `No account found for ${email}`;
  },
  {
    name: "check_account_status",
    description: "Look up a customer account by email to check their status, plan, and recent activity",
    schema: z.object({
      email: z.string().describe("The customer's email address"),
    }),
  }
);

const escalate_to_human = tool(
  ({ reason, priority }) => {
    return `Ticket created: [${priority.toUpperCase()}] ${reason} — assigned to next available agent. Reference: TK-${Date.now().toString(36).toUpperCase()}`;
  },
  {
    name: "escalate_to_human",
    description:
      "Escalate the issue to a human support agent when the AI cannot resolve it",
    schema: z.object({
      reason: z.string().describe("Why this needs human attention"),
      priority: z
        .enum(["low", "medium", "high", "critical"])
        .describe("Urgency level"),
    }),
  }
);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Graphmind Context Graph — Live Agent Demo");
  console.log(`Tenant: ${TENANT} | Project: ${PROJECT}\n`);

  // ── 1. Initialize Context Graph ───────────────────────────────────────────

  divider("1. Initializing Context Graph");

  const embeddingProvider = await createEmbeddingProvider();

  const contextGraph: ContextGraphInstance = await createContextGraph({
    tenant: TENANT,
    project: PROJECT,
    domain: "support",
    agent: "support-agent",
    agentDescription: "Customer support agent handling account and API issues",
    embedding: {
      provider: embeddingProvider,
      dimensions: embeddingProvider.dimensions,
    },
    observerModel: getObserverModel(),
    baseSystemPrompt: `You are a helpful customer support agent for a SaaS product.
Be concise and friendly. Use the available tools to look up information before answering.
Always explain your reasoning when making decisions.`,
    debug: false,
  });

  console.log("Context Graph initialized.");
  console.log(`  Graph namespace: ${contextGraph.store.getGraphName()}`);

  const initialStats = await contextGraph.lifecycle.getLifecycleStats();
  console.log(`  Existing traces: ${initialStats.total}`);

  // ── 2. Create Agent ───────────────────────────────────────────────────────

  const checkpointer = new MemorySaver();

  const agent = createAgent({
    model: getModel(),
    tools: [search_knowledge_base, check_account_status, escalate_to_human],
    middleware: contextGraph.middleware as any,
    checkpointer,
  });

  // ── 3. First Conversation — Locked Account ───────────────────────────────

  divider("2. Conversation 1: Locked Account");
  console.log("Scenario: Bob's account is locked after failed login attempts.\n");

  const result1 = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content:
            "Hi, I can't log into my account. My email is bob@example.com and it says my account is locked. Can you help?",
        },
      ],
    },
    { configurable: { thread_id: "conv-1" } }
  );

  printMessages(result1.messages);

  // ── 4. Second Conversation — Similar Issue (Context Should Be Injected) ──

  divider("3. Conversation 2: Another Locked Account");
  console.log(
    "Scenario: Different user, similar issue. The agent should now have context from Conversation 1.\n"
  );

  const result2 = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content:
            "My account seems to be locked out. I keep getting an error when trying to sign in. What should I do?",
        },
      ],
    },
    { configurable: { thread_id: "conv-2" } }
  );

  printMessages(result2.messages);

  // ── 5. Third Conversation — Different Topic (API Rate Limits) ─────────────

  divider("4. Conversation 3: API Rate Limits");
  console.log("Scenario: A developer hitting API rate limits — different domain.\n");

  const result3 = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content:
            "I'm getting 429 errors from your API. I'm on the free tier. How can I handle this and what are my options to increase the limit?",
        },
      ],
    },
    { configurable: { thread_id: "conv-3" } }
  );

  printMessages(result3.messages);

  // ── 6. Validate & Evolve Knowledge ────────────────────────────────────────

  divider("5. Knowledge Lifecycle");

  const stats = await contextGraph.lifecycle.getLifecycleStats();
  console.log("Trace statistics:");
  console.log(`  Captured:      ${stats.captured}`);
  console.log(`  Validated:     ${stats.validated}`);
  console.log(`  Synthesized:   ${stats.synthesized}`);
  console.log(`  Anti-patterns: ${stats.antiPatterns}`);
  console.log(`  Total:         ${stats.total}`);

  // Synthesize rules from validated traces
  const promoted = await contextGraph.lifecycle.synthesizeRules();
  if (promoted.length > 0) {
    console.log(`\nPromoted ${promoted.length} trace(s) to permanent rules.`);
  }

  // Prune failures
  const pruned = await contextGraph.lifecycle.pruneFailures();
  if (pruned.length > 0) {
    console.log(`Pruned ${pruned.length} trace(s) as anti-patterns.`);
  }

  // ── 7. Show What the Context Graph Captured ───────────────────────────────

  divider("6. Context Graph Contents");

  const rules = await contextGraph.store.getActiveRules();
  if (rules.length > 0) {
    console.log(`Active rules (${rules.length}):`);
    for (const rule of rules) {
      console.log(
        `  - [${rule.justification.confidence.toFixed(2)}] ${rule.justification.description.slice(0, 100)}`
      );
    }
  }

  const antiPatterns = await contextGraph.store.getAntiPatterns();
  if (antiPatterns.length > 0) {
    console.log(`\nAnti-patterns (${antiPatterns.length}):`);
    for (const ap of antiPatterns) {
      console.log(`  - ${ap.justification.description.slice(0, 100)}`);
    }
  }

  // Show concepts that link traces
  const concepts = await contextGraph.store.getConceptsByProject();
  if (concepts.length > 0) {
    console.log(`\nConcepts (tags linking similar traces):`);
    for (const c of concepts) {
      console.log(`  #${c.name} — ${c.traceCount} trace(s)`);
    }
  }

  // Show tool usage statistics
  const toolStats = await contextGraph.store.getToolStats();
  if (toolStats.length > 0) {
    console.log(`\nTool usage:`);
    for (const ts of toolStats) {
      console.log(`  ${ts.toolName}: ${ts.callCount} call(s)`);
    }
  }

  // Show agents
  const agents = await contextGraph.store.getAgentsByProject();
  if (agents.length > 0) {
    console.log(`\nAgents:`);
    for (const ag of agents) {
      console.log(`  ${ag.name}${ag.description ? ` — ${ag.description}` : ""}`);
    }
  }

  const finalStats = await contextGraph.lifecycle.getLifecycleStats();
  console.log(`\nFinal statistics:`);
  console.log(`  Total traces:  ${finalStats.total}`);
  console.log(`  Rules:         ${finalStats.synthesized}`);
  console.log(`  Anti-patterns: ${finalStats.antiPatterns}`);

  divider("Done!");
  console.log(
    "Run this script again — the agent will now use past decision traces as context.\n"
  );
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
