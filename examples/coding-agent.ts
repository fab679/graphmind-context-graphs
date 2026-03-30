/**
 * Coding Agent — Brain Mapping with Context Graphs
 *
 * This example demonstrates the key differentiator of Context Graphs:
 * agents that build a map of their understanding over time.
 *
 * The coding agent:
 *   1. Analyzes files and creates CodeFile, Function, and Dependency entities
 *   2. Maps relationships (IMPORTS, EXPORTS, DEPENDS_ON) between entities
 *   3. Captures decision traces when making architectural choices
 *   4. Uses schema inspection to understand what it already knows
 *   5. Over time, builds a "brain map" of the codebase it's working with
 *
 * This is what makes Context Graphs different from knowledge graphs:
 * the entities aren't pre-defined — the agent discovers them through work.
 *
 * Prerequisites:
 *   - Graphmind running: docker run -d -p 8080:8080 fabischk/graphmind:latest
 *   - Environment variables in .env (see .env.example)
 *
 * Usage:
 *   npx tsx examples/coding-agent.ts
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

// ── Simulated Codebase Tools ────────────────────────────────────────────────

const read_file = tool(
  ({ path }) => {
    const files: Record<string, string> = {
      "src/auth/login.ts": `import { hashPassword } from './crypto';
import { getUserByEmail } from '../db/users';
import { createSession } from './session';
import { rateLimit } from '../middleware/rate-limiter';

// IMPORTANT: Rate limiting added after brute-force incident (2024-Q3)
export async function login(email: string, password: string) {
  await rateLimit(email, { maxAttempts: 5, windowMs: 30 * 60 * 1000 });
  const user = await getUserByEmail(email);
  if (!user) throw new AuthError('Invalid credentials');
  const valid = await hashPassword(password) === user.passwordHash;
  if (!valid) {
    await incrementFailedAttempts(email);
    throw new AuthError('Invalid credentials');
  }
  return createSession(user);
}`,
      "src/auth/session.ts": `import { sign, verify } from 'jsonwebtoken';
import { SessionStore } from '../db/sessions';

// Session tokens expire in 24h — compliance requirement from legal review
const SESSION_TTL = 24 * 60 * 60 * 1000;

export function createSession(user: User) {
  const token = sign({ userId: user.id, role: user.role }, process.env.JWT_SECRET!, { expiresIn: '24h' });
  SessionStore.set(token, { userId: user.id, expiresAt: Date.now() + SESSION_TTL });
  return { token, expiresAt: Date.now() + SESSION_TTL };
}`,
      "src/middleware/rate-limiter.ts": `import { Redis } from 'ioredis';
const redis = new Redis(process.env.REDIS_URL);

// Rate limiter uses sliding window — fixed window had bypass vulnerability
export async function rateLimit(key: string, opts: { maxAttempts: number; windowMs: number }) {
  const count = await redis.incr(\`rate:\${key}\`);
  if (count === 1) await redis.pexpire(\`rate:\${key}\`, opts.windowMs);
  if (count > opts.maxAttempts) throw new RateLimitError('Too many attempts');
}`,
      "src/db/users.ts": `import { pool } from './connection';

export async function getUserByEmail(email: string) {
  const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
  return result.rows[0] ?? null;
}`,
    };
    return files[path] ?? `File not found: ${path}`;
  },
  {
    name: "read_file",
    description: "Read the contents of a source code file",
    schema: z.object({
      path: z.string().describe("File path relative to project root"),
    }),
  }
);

const list_files = tool(
  ({ directory }) => {
    const tree: Record<string, string[]> = {
      "src": ["auth/", "db/", "middleware/", "api/", "index.ts"],
      "src/auth": ["login.ts", "session.ts", "crypto.ts", "permissions.ts"],
      "src/db": ["connection.ts", "users.ts", "sessions.ts", "migrations/"],
      "src/middleware": ["rate-limiter.ts", "cors.ts", "error-handler.ts"],
      "src/api": ["routes.ts", "handlers/"],
    };
    const files = tree[directory];
    return files
      ? `Contents of ${directory}/:\n${files.map((f) => `  ${f}`).join("\n")}`
      : `Directory not found: ${directory}`;
  },
  {
    name: "list_files",
    description: "List files in a directory",
    schema: z.object({
      directory: z.string().describe("Directory path"),
    }),
  }
);

const search_code = tool(
  ({ query }) => {
    const results: Record<string, string[]> = {
      rateLimit: [
        "src/auth/login.ts:6 — import { rateLimit } from '../middleware/rate-limiter'",
        "src/auth/login.ts:9 — await rateLimit(email, { maxAttempts: 5, windowMs: 30 * 60 * 1000 })",
        "src/middleware/rate-limiter.ts:4 — export async function rateLimit(key, opts)",
      ],
      session: [
        "src/auth/login.ts:3 — import { createSession } from './session'",
        "src/auth/session.ts:6 — export function createSession(user)",
        "src/db/sessions.ts:1 — export class SessionStore",
      ],
      password: [
        "src/auth/login.ts:1 — import { hashPassword } from './crypto'",
        "src/auth/login.ts:11 — const valid = await hashPassword(password) === user.passwordHash",
      ],
    };
    const key = Object.keys(results).find((k) => query.toLowerCase().includes(k.toLowerCase()));
    return key
      ? `Search results for "${query}":\n${results[key].join("\n")}`
      : `No results found for "${query}"`;
  },
  {
    name: "search_code",
    description: "Search the codebase for code patterns, function names, or references",
    schema: z.object({
      query: z.string().describe("Code pattern or term to search for"),
    }),
  }
);

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("Context Graph — Coding Agent Brain Mapping Demo\n");

  // ── 1. Initialize ─────────────────────────────────────────────────────────

  divider("1. Initialize Context Graph");

  const embeddingProvider = await createEmbeddingProvider();

  const cg: ContextGraphInstance = await createContextGraph({
    tenant: "dev_team",
    project: "backend-api",
    domain: "software-engineering",
    agent: "code-reviewer",
    agentDescription: "Code analysis agent that builds understanding of a codebase over time",
    embedding: {
      provider: embeddingProvider,
      dimensions: embeddingProvider.dimensions,
    },
    observerModel: getObserverModel(),
    baseSystemPrompt: `You are a senior software engineer analyzing a codebase. Use create_entity to record files and design decisions you discover. Use create_relationship to map connections between them. Be concise — only create entities for things that matter.`,
    debug: false,
  });

  console.log("Context Graph initialized.");
  console.log(`  Graph: ${cg.store.getGraphName()}`);

  const schema = await cg.store.getSchemaOverview();
  console.log(`  Entity types: ${schema.nodeLabels.length}`);
  console.log(`  Relationship types: ${schema.relationshipTypes.length}`);

  // ── 2. Create Agent with Brain-Mapping Tools ──────────────────────────────

  const agent = createAgent({
    model: getModel(),
    tools: [
      read_file,
      list_files,
      search_code,
      ...cg.tools as any[],
      createSkillTool(cg.store),
      createListSkillsTool(cg.store),
    ],
    middleware: cg.middleware as any,
    checkpointer: new MemorySaver(),
    recursionLimit: 50,
  });

  // ── 3. First Task — Analyze Auth Flow ─────────────────────────────────────

  divider("2. Task: Analyze the authentication flow");
  console.log("The agent reads code, discovers dependencies, and maps its understanding.\n");

  try {
    const r1 = await agent.invoke(
      {
        messages: [
          {
            role: "user",
            content: `Read src/auth/login.ts and src/auth/session.ts. For each file, create a CodeFile entity with its path and purpose. If you spot an important design decision or constraint in the code comments, create an entity for that too. Keep it brief — just map the key files and one or two relationships between them.`,
          },
        ],
      },
      { configurable: { thread_id: "analyze-auth" } }
    );
    printMessages(r1.messages);
  } catch (err: any) {
    console.error("Task failed:", err.message);
    if (err.errors) {
      for (const e of err.errors) console.error("  →", e.message ?? e);
    }
  }

  // ── 4. Show the Brain Map ─────────────────────────────────────────────────

  divider("3. Brain Map After Analysis");

  const updatedSchema = await cg.store.getSchemaOverview();
  console.log("Entity types in the brain map:");
  for (const label of updatedSchema.nodeLabels) {
    console.log(`  ${label}: ${updatedSchema.nodeCounts[label]} node(s)`);
  }
  console.log("\nRelationship types:");
  for (const type of updatedSchema.relationshipTypes) {
    console.log(`  ${type}: ${updatedSchema.edgeCounts[type]} edge(s)`);
  }

  // ── 5. Second Task — Change Impact Analysis ───────────────────────────────

  divider("4. Task: Impact Analysis (using brain map)");
  console.log("The agent uses its existing brain map to answer a question.\n");

  try {
    const r2 = await agent.invoke(
      {
        messages: [
          {
            role: "user",
            content: `We want to change the session token expiry from 24h to 1h. Use inspect_schema to check what you already know, then tell me which files are affected and any constraints to consider.`,
          },
        ],
      },
      { configurable: { thread_id: "impact-analysis" } }
    );
    printMessages(r2.messages);
  } catch (err: any) {
    console.error("Task failed:", err.message);
    if (err.errors) {
      for (const e of err.errors) console.error("  →", e.message ?? e);
    }
  }

  // ── 6. Lifecycle ──────────────────────────────────────────────────────────

  divider("5. Decision Trace Statistics");

  const stats = await cg.lifecycle.getLifecycleStats();
  console.log(`Traces: ${stats.total}`);
  console.log(`  Captured:    ${stats.captured}`);
  console.log(`  Validated:   ${stats.validated}`);
  console.log(`  Synthesized: ${stats.synthesized}`);

  const concepts = await cg.store.getConceptsByProject();
  if (concepts.length > 0) {
    console.log("\nConcepts discovered:");
    for (const c of concepts) {
      console.log(`  #${c.name} — ${c.traceCount} trace(s)`);
    }
  }

  const toolStats = await cg.store.getToolStats();
  if (toolStats.length > 0) {
    console.log("\nTool usage:");
    for (const ts of toolStats) {
      console.log(`  ${ts.toolName}: ${ts.callCount} call(s)`);
    }
  }

  divider("Done!");
  console.log("The agent has built a brain map of the codebase.");
  console.log("Run again — it will use this map to answer questions with more context.\n");
}

main().catch((err) => {
  console.error("Error:", err.message);
  // Show underlying errors from LangGraph superstep failures
  if (err.errors) {
    for (const [i, e] of err.errors.entries()) {
      console.error(`  Error ${i + 1}:`, e.message ?? e);
    }
  }
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});
