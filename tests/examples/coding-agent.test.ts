import { describe, it, expect } from "vitest";

/**
 * Example: Coding Agent with Context Graph
 *
 * Demonstrates the "Contextual Debt Recovery" use case from KILLER_FEATURE.md:
 * When an agent looks at a function, the middleware injects WHY that code exists.
 *
 * Prerequisites:
 * - Running Graphmind instance
 * - OPENAI_API_KEY environment variable set
 * - GRAPHMIND_URL environment variable set
 */

const canRun =
  !!process.env.GRAPHMIND_URL && !!process.env.OPENAI_API_KEY;

describe.skipIf(!canRun)("Coding agent with Context Graph", () => {
  it("should capture coding decisions and provide context", async () => {
    const { createAgent, tool } = await import("langchain");
    const { z } = await import("zod");
    const { createContextGraph } = await import("../../src/index.js");
    const { OpenAIEmbeddings } = await import("@langchain/openai");

    const embeddings = new OpenAIEmbeddings({
      model: "text-embedding-3-small",
    });

    const embeddingProvider = {
      embed: async (text: string) => embeddings.embedQuery(text),
      embedBatch: async (texts: string[]) =>
        embeddings.embedDocuments(texts),
      dimensions: 1536,
    };

    const contextGraph = await createContextGraph({
      graphmind: { url: process.env.GRAPHMIND_URL! },
      tenant: "coding_agent_" + Date.now(),
      project: "my_codebase",
      embedding: { provider: embeddingProvider, dimensions: 1536 },
      observerModel: "openai:gpt-4.1-mini",
      baseSystemPrompt:
        "You are a coding assistant. When making decisions about code, explain your reasoning.",
      debug: true,
    });

    // Simulate a coding tool
    const readFile = tool(
      ({ path }) => {
        const files: Record<string, string> = {
          "auth.ts": `
// IMPORTANT: Using bcrypt with cost factor 12
// Do NOT reduce cost factor - security audit requirement (2024-Q3)
export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}`,
          "api.ts": `
// Using fetch instead of axios - team convention since 2024
// See: https://internal.wiki/standards/http-client
export async function callApi(url: string) {
  return fetch(url);
}`,
        };
        return files[path] ?? "File not found";
      },
      {
        name: "read_file",
        description: "Read a source code file",
        schema: z.object({ path: z.string() }),
      }
    );

    const agent = createAgent({
      model: "openai:gpt-4.1-mini",
      tools: [readFile],
      middleware: contextGraph.middleware,
    });

    // First interaction: ask about the auth code
    await agent.invoke({
      messages: [
        {
          role: "user",
          content:
            "Read auth.ts and explain why bcrypt cost factor is 12",
        },
      ],
    });

    // The context graph should now have a trace about the auth decision
    const stats = await contextGraph.lifecycle.getLifecycleStats();
    expect(stats.captured).toBeGreaterThanOrEqual(1);

    // Second interaction: the context from the first should be injected
    const result2 = await agent.invoke({
      messages: [
        {
          role: "user",
          content:
            "I want to change the bcrypt cost factor in auth.ts. Should I?",
        },
      ],
    });

    // The agent should have context about why the cost factor was chosen
    expect(result2.messages).toBeDefined();
  });
});
