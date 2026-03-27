import { describe, it, expect, beforeAll } from "vitest";

/**
 * Example: Basic agent with Context Graph middleware
 *
 * This test demonstrates how to create a LangChain agent with
 * the Context Graph middleware for decision trace capture.
 *
 * Prerequisites:
 * - Running Graphmind instance (docker run -d -p 8080:8080 fabischk/graphmind:latest)
 * - OPENAI_API_KEY environment variable set
 * - GRAPHMIND_URL environment variable set
 *
 * Run with: GRAPHMIND_URL=http://localhost:8080 OPENAI_API_KEY=sk-... npm run test:examples
 */

const canRun =
  !!process.env.GRAPHMIND_URL && !!process.env.OPENAI_API_KEY;

describe.skipIf(!canRun)("Basic agent with Context Graph", () => {
  it("should create an agent with context graph middleware", async () => {
    const { createAgent, tool } = await import("langchain");
    const { z } = await import("zod");
    const { createContextGraph } = await import("../../src/index.js");

    // Create a simple embedding provider using OpenAI
    const { OpenAIEmbeddings } = await import("@langchain/openai");
    const embeddings = new OpenAIEmbeddings({
      model: "text-embedding-3-small",
    });

    const embeddingProvider = {
      embed: async (text: string) => {
        const result = await embeddings.embedQuery(text);
        return result;
      },
      embedBatch: async (texts: string[]) => {
        const results = await embeddings.embedDocuments(texts);
        return results;
      },
      dimensions: 1536,
    };

    // Initialize context graph
    const contextGraph = await createContextGraph({
      graphmind: { url: process.env.GRAPHMIND_URL! },
      tenant: "example_tenant",
      project: "basic_agent_test",
      embedding: {
        provider: embeddingProvider,
        dimensions: 1536,
      },
      observerModel: "openai:gpt-4.1-mini",
      debug: true,
    });

    expect(contextGraph.middleware).toHaveLength(2);
    expect(contextGraph.registry).toBeDefined();
    expect(contextGraph.lifecycle).toBeDefined();
    expect(contextGraph.store).toBeDefined();

    // Create a simple tool
    const lookupWeather = tool(
      ({ city }) => `Weather in ${city}: Sunny, 72°F`,
      {
        name: "lookup_weather",
        description: "Get weather for a city",
        schema: z.object({ city: z.string() }),
      }
    );

    // Create agent with context graph middleware
    const agent = createAgent({
      model: "openai:gpt-4.1-mini",
      tools: [lookupWeather],
      middleware: contextGraph.middleware,
    });

    // First invocation - captures decision trace
    const result1 = await agent.invoke({
      messages: [
        { role: "user", content: "What's the weather in Tokyo?" },
      ],
    });

    expect(result1.messages).toBeDefined();
    expect(result1.messages.length).toBeGreaterThan(0);

    // Check that a trace was captured
    const stats = await contextGraph.lifecycle.getLifecycleStats();
    expect(stats.total).toBeGreaterThanOrEqual(1);
  });
});
