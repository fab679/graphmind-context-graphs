import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { GraphmindStore } from "../../src/db/client.js";
import type { ContextGraphConfig } from "../../src/types/config.js";

/**
 * Integration tests require a running Graphmind instance.
 * Start one with: docker run -d --name graphmind -p 8080:8080 fabischk/graphmind:latest
 *
 * Run these tests with: npm run test:integration
 */

const GRAPHMIND_URL = process.env.GRAPHMIND_URL ?? "http://localhost:8080";
const TEST_TENANT = "integration_test_" + Date.now();

function createIntegrationConfig(): ContextGraphConfig {
  return {
    graphmind: { url: GRAPHMIND_URL },
    tenant: TEST_TENANT,
    project: "test_project",
    embedding: {
      provider: {
        embed: async (text: string) => {
          // Simple hash-based embedding for testing
          const hash = Array.from(text).reduce(
            (h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0,
            0
          );
          return Array.from({ length: 3 }, (_, i) =>
            Math.sin(hash + i)
          );
        },
        embedBatch: async (texts: string[]) =>
          Promise.all(
            texts.map(async (t) => {
              const hash = Array.from(t).reduce(
                (h, c) => ((h << 5) - h + c.charCodeAt(0)) | 0,
                0
              );
              return Array.from({ length: 3 }, (_, i) =>
                Math.sin(hash + i)
              );
            })
          ),
        dimensions: 3,
      },
      dimensions: 3,
    },
    debug: true,
  };
}

describe.skipIf(!process.env.GRAPHMIND_URL)(
  "GraphmindStore integration",
  () => {
    let store: GraphmindStore;

    beforeAll(async () => {
      store = new GraphmindStore(createIntegrationConfig());
      await store.initialize();
    });

    it("should save and retrieve a decision trace", async () => {
      const traceId = await store.saveDecisionTrace({
        intent: {
          description: "Deploy to production",
          createdAt: new Date().toISOString(),
        },
        constraints: [
          {
            description: "All tests must pass",
            type: "blocker",
            createdAt: new Date().toISOString(),
          },
        ],
        action: {
          description: "Executed CI/CD pipeline",
          outcome: "success",
          createdAt: new Date().toISOString(),
        },
        justification: {
          description:
            "Tests passed and code review was approved",
          confidence: 0.85,
        },
        project: "test_project",
        tenant: TEST_TENANT,
        status: "captured",
      });

      expect(traceId).toBeDefined();

      const trace = await store.getTraceById(traceId);
      expect(trace).not.toBeNull();
      expect(trace!.intent.description).toBe("Deploy to production");
      expect(trace!.constraints).toHaveLength(1);
      expect(trace!.action.description).toBe("Executed CI/CD pipeline");
    });

    it("should update trace status", async () => {
      const traceId = await store.saveDecisionTrace({
        intent: {
          description: "Fix bug",
          createdAt: new Date().toISOString(),
        },
        constraints: [],
        action: {
          description: "Applied patch",
          createdAt: new Date().toISOString(),
        },
        justification: {
          description: "Root cause identified",
          confidence: 0.7,
        },
        project: "test_project",
        tenant: TEST_TENANT,
        status: "captured",
      });

      await store.updateTraceStatus(traceId, "validated");

      const trace = await store.getTraceById(traceId);
      expect(trace!.status).toBe("validated");
    });

    it("should count traces for the project", async () => {
      const count = await store.countTraces();
      expect(count).toBeGreaterThanOrEqual(2);
    });

    it("should return lifecycle stats", async () => {
      const stats = await store.getLifecycleStats();
      expect(stats.total).toBeGreaterThanOrEqual(2);
    });
  }
);
