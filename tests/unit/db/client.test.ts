import { describe, it, expect, vi, beforeEach } from "vitest";
import { GraphmindStore } from "../../../src/db/client.js";
import type { ContextGraphConfig } from "../../../src/types/config.js";

// Mock graphmind-sdk
vi.mock("graphmind-sdk", () => {
  const GraphmindClient = class {
    query = vi.fn().mockResolvedValue({ records: [[1]], columns: ["traceId"] });
    queryReadonly = vi.fn().mockResolvedValue({ records: [], columns: [] });
    schema = vi.fn().mockResolvedValue({ node_types: [], edge_types: [] });
    constructor(_opts: any) {}
  };
  return { GraphmindClient };
});

function createTestConfig(): ContextGraphConfig {
  return {
    graphmind: { url: "http://localhost:8080" },
    tenant: "test_tenant",
    project: "test_project",
    embedding: {
      provider: {
        embed: async () => [0.1, 0.2, 0.3],
        embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
        dimensions: 3,
      },
      dimensions: 3,
    },
    debug: false,
  };
}

describe("GraphmindStore", () => {
  let store: GraphmindStore;

  beforeEach(() => {
    vi.clearAllMocks();
    store = new GraphmindStore(createTestConfig());
  });

  it("should create with correct graph namespace", () => {
    expect(store.getGraphName()).toBe("cg_test_tenant");
  });

  it("should save a decision trace and return an id", async () => {
    const traceId = await store.saveDecisionTrace({
      intent: {
        description: "Test intent",
        createdAt: new Date().toISOString(),
      },
      constraints: [
        {
          description: "Test constraint",
          type: "blocker",
          createdAt: new Date().toISOString(),
        },
      ],
      action: {
        description: "Test action",
        outcome: "pending",
        createdAt: new Date().toISOString(),
      },
      justification: {
        description: "Test justification",
        confidence: 0.8,
      },
      project: "test_project",
      tenant: "test_tenant",
      status: "captured",
    });

    expect(traceId).toBe("1");
  });

  it("should return null for non-existent trace", async () => {
    const trace = await store.getTraceById("999");
    expect(trace).toBeNull();
  });

  it("should count traces", async () => {
    const count = await store.countTraces();
    expect(count).toBe(0);
  });

  it("should return lifecycle stats with zero counts when empty", async () => {
    const stats = await store.getLifecycleStats();
    expect(stats.total).toBe(0);
    expect(stats.captured).toBe(0);
    expect(stats.validated).toBe(0);
    expect(stats.synthesized).toBe(0);
    expect(stats.antiPatterns).toBe(0);
    expect(stats.pruned).toBe(0);
  });
});
