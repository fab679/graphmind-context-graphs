/**
 * Runtime Context Example
 *
 * Demonstrates how Graphmind middleware can accept per-invocation runtime context
 * via LangChain's `contextSchema` mechanism. This example now includes:
 *   1. Defining a shared runtime context schema for the agent
 *   2. Passing request-scoped metadata through `agent.invoke(..., { context })`
 *   3. **NEW**: Automatically creating new tenants from runtime context
 *   4. Injecting runtime metadata into the system prompt
 *   5. Recording trace metadata with optional domain/agent overrides
 *
 * The runtime tenant override will:
 * - Create a new context graph for the specified tenant if it doesn't exist
 * - Query and save traces to the correct tenant's isolated graph
 * - Support multi-tenant SaaS use cases where each customer gets their own context
 *
 * Usage:
 *   npx tsx examples/runtime-context.ts
 */

import { createAgent, tool } from "langchain";
import { z } from "zod";
import { createContextGraph } from "../src/index.js";
import {
  createEmbeddingProvider,
  getModel,
  getObserverModel,
  divider,
  printMessages,
} from "./shared/provider.js";

const graphmindContextSchema = z.object({
  tenant: z
    .string()
    .optional()
    .describe("Optional Graphmind tenant override for the current request."),
  project: z
    .string()
    .optional()
    .describe("Optional Graphmind project override for the current request."),
  agent: z
    .string()
    .optional()
    .describe("Optional Graphmind agent override for the current request."),
  agentDescription: z
    .string()
    .optional()
    .describe("Optional agent description override for the current request."),
  baseSystemPrompt: z
    .string()
    .optional()
    .describe("Optional base system prompt override for the current request."),
  debug: z
    .boolean()
    .optional()
    .describe("Optional debug override for the current request."),
  embedding: z
    .any()
    .optional()
    .describe("Optional embedding provider override for the current request."),
  note: z
    .string()
    .optional()
    .describe("Optional human-readable note for this request."),
});

const supportLookup = tool(
  ({ query }) => {
    const answers: Record<string, string> = {
      graphmind:
        "Graphmind is a decision-graph database for capturing why AI agents acted, not just what they did.",
      context:
        "Runtime context allows per-request metadata to be passed into middleware without persisting it across invocations.",
      agent:
        "The agent can use runtime context to annotate or adjust behavior for the current request.",
    };

    const key = Object.keys(answers).find((k) =>
      query.toLowerCase().includes(k),
    );
    return key
      ? answers[key]
      : `I don't have a direct answer for '${query}', but I can still help explain how runtime context works.`;
  },
  {
    name: "support_lookup",
    description: "Look up support knowledge for runtime context examples",
    schema: z.object({ query: z.string() }),
  },
);

async function main() {
  console.log("Graphmind Runtime Context Example\n");

  divider("1. Initialize Context Graph");

  const embeddingProvider = await createEmbeddingProvider();

  const cg = await createContextGraph({
    tenant: "base-tenant",
    project: "base-project",
    embedding: {
      provider: embeddingProvider,
      dimensions: embeddingProvider.dimensions,
    },
    contextSchema: graphmindContextSchema,
  });

  console.log("Context Graph initialized.");
  console.log(`  Graph: ${cg.store.getGraphName()}`);
  console.log(
    "  Note: runtime tenant/project values are supplied per request below.",
  );
  console.log(`  Context schema exported: ${Boolean(cg.contextSchema)}`);

  divider("2. Create Agent with runtime context schema");

  const agent = createAgent({
    model: getModel(),
    tools: [supportLookup],
    middleware: cg.middleware as any,
    contextSchema: graphmindContextSchema,
  });

  divider("3. First request with runtime metadata");

  const runtimeContext1 = {
    tenant: "runtime-demo",
    project: "runtime-context",
    agent: "runtime-context-agent",
    agentDescription: "Runtime context demo agent",
    embedding: {
      provider: embeddingProvider,
      dimensions: embeddingProvider.dimensions,
    },
    baseSystemPrompt:
      "You are a context-aware assistant. Use available request metadata to improve the response.",
    debug: true,
    note: "First runtime-context test",
  };

  console.log("Request 1 runtime context:", {
    tenant: runtimeContext1.tenant,
    project: runtimeContext1.project,
    agent: runtimeContext1.agent,
    agentDescription: runtimeContext1.agentDescription,
    embeddingOverride: Boolean(runtimeContext1.embedding),
    baseSystemPrompt: runtimeContext1.baseSystemPrompt,
    debug: runtimeContext1.debug,
    note: runtimeContext1.note,
  });

  const result1 = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content:
            "Explain how runtime context works for Graphmind middleware and why it is useful.",
        },
      ],
    },
    {
      context: runtimeContext1,
    },
  );

  printMessages(result1.messages);

  divider("4. Second request with agent/domain overrides");

  const runtimeContext2 = {
    tenant: "runtime-demo-override",
    project: "runtime-context-override",
    agent: "sales-support-agent",
    agentDescription: "Sales support agent for this request",
    embedding: {
      provider: embeddingProvider,
      dimensions: embeddingProvider.dimensions,
    },
    baseSystemPrompt:
      "You are a context-aware assistant. Use available request metadata to improve the response.",
    debug: true,
    note: "Second runtime-context test with overrides",
  };

  console.log("Request 2 runtime context:", {
    tenant: runtimeContext2.tenant,
    project: runtimeContext2.project,
    agent: runtimeContext2.agent,
    agentDescription: runtimeContext2.agentDescription,
    embeddingOverride: Boolean(runtimeContext2.embedding),
    baseSystemPrompt: runtimeContext2.baseSystemPrompt,
    debug: runtimeContext2.debug,
    note: runtimeContext2.note,
  });

  const result2 = await agent.invoke(
    {
      messages: [
        {
          role: "user",
          content:
            "What is runtime context and can I override the agent or domain for a request?",
        },
      ],
    },
    {
      context: runtimeContext2,
    },
  );

  printMessages(result2.messages);

  divider("5. Summary");

  console.log(
    "This example shows how to pass per-request metadata using LangChain runtime context.",
  );
  console.log(
    "Use `contextSchema` to validate the fields and let middleware access them via `request.runtime.context`.",
  );
  console.log(
    "In Graphmind middleware, request metadata can be injected into prompts and used to annotate trace metadata.",
  );
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
