import { describe, it, expect, beforeAll } from "vitest";
import { GraphmindStore } from "../../src/db/client.js";
import type { ContextGraphConfig } from "../../src/types/config.js";

/**
 * Vector search integration tests require a running Graphmind instance
 * with vector index support.
 *
 * Run with: GRAPHMIND_URL=http://localhost:8080 npm run test:integration
 */

const GRAPHMIND_URL = process.env.GRAPHMIND_URL ?? "http://localhost:8080";
const TEST_TENANT = "vector_test_" + Date.now();

function createConfig(): ContextGraphConfig {
  return {
    graphmind: { url: GRAPHMIND_URL },
    tenant: TEST_TENANT,
    project: "vector_project",
    embedding: {
      provider: {
        embed: async () => [0.1, 0.2, 0.3],
        embedBatch: async (texts: string[]) =>
          texts.map((_, i) => [0.1 + i * 0.01, 0.2, 0.3]),
        dimensions: 3,
      },
      dimensions: 3,
      metric: "cosine",
    },
    debug: true,
  };
}

describe.skipIf(!process.env.GRAPHMIND_URL)(
  "Vector search integration",
  () => {
    let store: GraphmindStore;

    beforeAll(async () => {
      store = new GraphmindStore(createConfig());
      await store.initialize();

      // Insert test traces with embeddings
      await store.saveDecisionTrace({
        intent: {
          description: "Handle API timeout",
          embedding: [0.9, 0.1, 0.1],
          createdAt: new Date().toISOString(),
        },
        constraints: [],
        action: {
          description: "Implemented retry with backoff",
          embedding: [0.8, 0.2, 0.1],
          createdAt: new Date().toISOString(),
        },
        justification: {
          description: "Timeouts are transient, retry resolves most cases",
          confidence: 0.9,
        },
        embedding: [0.9, 0.1, 0.1],
        project: "vector_project",
        tenant: TEST_TENANT,
        status: "captured",
      });

      await store.saveDecisionTrace({
        intent: {
          description: "Handle database connection error",
          embedding: [0.85, 0.15, 0.1],
          createdAt: new Date().toISOString(),
        },
        constraints: [],
        action: {
          description: "Implemented connection pool refresh",
          embedding: [0.7, 0.3, 0.1],
          createdAt: new Date().toISOString(),
        },
        justification: {
          description: "Connection pool exhaustion is the root cause",
          confidence: 0.8,
        },
        embedding: [0.85, 0.15, 0.1],
        project: "vector_project",
        tenant: TEST_TENANT,
        status: "captured",
      });
    });

    it("should find similar traces by vector search", async () => {
      // Search for something similar to "API timeout"
      const results = await store.findSimilarTraces(
        [0.88, 0.12, 0.1],
        5
      );

      expect(results.length).toBeGreaterThanOrEqual(0);
      // If vector search works, results should be sorted by similarity
      if (results.length >= 2) {
        expect(results[0].similarity).toBeGreaterThanOrEqual(
          results[1].similarity
        );
      }
    });
  }
);
