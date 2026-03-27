import { describe, it, expect } from "vitest";

/**
 * Example: Multi-tenant Context Graph
 *
 * Demonstrates how different tenants have fully isolated context graphs.
 * Each tenant gets its own Graphmind graph namespace.
 *
 * Prerequisites:
 * - Running Graphmind instance
 * - OPENAI_API_KEY environment variable set
 * - GRAPHMIND_URL environment variable set
 */

const canRun =
  !!process.env.GRAPHMIND_URL && !!process.env.OPENAI_API_KEY;

describe.skipIf(!canRun)("Multi-tenant context isolation", () => {
  it("should isolate context between tenants", async () => {
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

    // Create two separate tenant instances
    const tenant1 = await createContextGraph({
      graphmind: { url: process.env.GRAPHMIND_URL! },
      tenant: "tenant_alpha_" + Date.now(),
      project: "project_a",
      embedding: { provider: embeddingProvider, dimensions: 1536 },
    });

    const tenant2 = await createContextGraph({
      graphmind: { url: process.env.GRAPHMIND_URL! },
      tenant: "tenant_beta_" + Date.now(),
      project: "project_b",
      embedding: { provider: embeddingProvider, dimensions: 1536 },
    });

    // Verify they use different graph namespaces
    expect(tenant1.store.getGraphName()).not.toBe(
      tenant2.store.getGraphName()
    );

    // Record a decision in tenant 1
    await tenant1.registry.recordDecision({
      intent: {
        description: "Process alpha customer request",
        createdAt: new Date().toISOString(),
      },
      constraints: [],
      action: {
        description: "Handled via alpha workflow",
        createdAt: new Date().toISOString(),
      },
      justification: {
        description: "Alpha-specific handling required",
        confidence: 0.8,
      },
      project: "project_a",
      tenant: "tenant_alpha",
      status: "captured",
    });

    // Tenant 2 should have no traces
    const tenant2Stats =
      await tenant2.lifecycle.getLifecycleStats();
    expect(tenant2Stats.total).toBe(0);

    // Tenant 1 should have 1 trace
    const tenant1Stats =
      await tenant1.lifecycle.getLifecycleStats();
    expect(tenant1Stats.total).toBe(1);
  });
});
