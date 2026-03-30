import { describe, it, expect, vi, beforeEach } from "vitest";
import { ContextualRegistry } from "../../../src/core/contextual-registry.js";
import type { ContextGraphConfig } from "../../../src/types/config.js";
import type { EmbeddingProvider } from "../../../src/embeddings/provider.js";

function createMockStore() {
  return {
    countTraces: vi.fn().mockResolvedValue(0),
    findSimilarTraces: vi.fn().mockResolvedValue([]),
    getActiveRules: vi.fn().mockResolvedValue([]),
    getAntiPatterns: vi.fn().mockResolvedValue([]),
    getSkillsByProject: vi.fn().mockResolvedValue([]),
    getSchemaOverview: vi.fn().mockResolvedValue({
      nodeLabels: [],
      relationshipTypes: [],
      nodeCounts: {},
      edgeCounts: {},
    }),
    saveDecisionTrace: vi.fn().mockResolvedValue("trace-1"),
    createPrecedentLink: vi.fn().mockResolvedValue(undefined),
    getTraceById: vi.fn().mockResolvedValue(null),
  } as any;
}

function createMockEmbeddingProvider(): EmbeddingProvider {
  return {
    embed: vi.fn().mockResolvedValue([0.1, 0.2, 0.3]),
    embedBatch: vi
      .fn()
      .mockImplementation((texts: string[]) =>
        Promise.resolve(texts.map(() => [0.1, 0.2, 0.3]))
      ),
    dimensions: 3,
  };
}

function createTestConfig(): ContextGraphConfig {
  return {
    graphmind: { url: "http://localhost:8080" },
    tenant: "test",
    project: "test_project",
    embedding: {
      provider: createMockEmbeddingProvider(),
      dimensions: 3,
    },
    debug: false,
  };
}

describe("ContextualRegistry", () => {
  let registry: ContextualRegistry;
  let store: ReturnType<typeof createMockStore>;
  let embeddingProvider: EmbeddingProvider;

  beforeEach(() => {
    store = createMockStore();
    embeddingProvider = createMockEmbeddingProvider();
    registry = new ContextualRegistry(
      store,
      embeddingProvider,
      createTestConfig()
    );
  });

  describe("isDiscoveryMode", () => {
    it("should return true when no traces exist", async () => {
      store.countTraces.mockResolvedValue(0);
      expect(await registry.isDiscoveryMode()).toBe(true);
    });

    it("should return false when traces exist", async () => {
      store.countTraces.mockResolvedValue(5);
      expect(await registry.isDiscoveryMode()).toBe(false);
    });

    it("should cache the discovery mode result", async () => {
      store.countTraces.mockResolvedValue(0);
      await registry.isDiscoveryMode();
      await registry.isDiscoveryMode();
      expect(store.countTraces).toHaveBeenCalledTimes(1);
    });
  });

  describe("getRelevantContext", () => {
    it("should embed the intent and query for similar traces", async () => {
      const context = await registry.getRelevantContext("Deploy application");

      expect(embeddingProvider.embed).toHaveBeenCalledWith(
        "Deploy application"
      );
      expect(store.findSimilarTraces).toHaveBeenCalled();
      expect(store.getActiveRules).toHaveBeenCalled();
      expect(store.getAntiPatterns).toHaveBeenCalled();
      expect(store.getSkillsByProject).toHaveBeenCalled();
      expect(context.pastTraces).toEqual([]);
      expect(context.rules).toEqual([]);
      expect(context.antiPatterns).toEqual([]);
      expect(context.skills).toEqual([]);
    });
  });

  describe("recordDecision", () => {
    it("should generate embeddings and save the trace", async () => {
      const traceId = await registry.recordDecision({
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
        tenant: "test",
        status: "captured",
      });

      expect(traceId).toBe("trace-1");
      expect(embeddingProvider.embedBatch).toHaveBeenCalled();
      expect(store.saveDecisionTrace).toHaveBeenCalled();

      // Verify the saved trace has embeddings
      const savedTrace = store.saveDecisionTrace.mock.calls[0][0];
      expect(savedTrace.embedding).toBeDefined();
      expect(savedTrace.intent.embedding).toBeDefined();
      expect(savedTrace.action.embedding).toBeDefined();
    });

    it("should link precedents for similar traces", async () => {
      store.findSimilarTraces.mockResolvedValue([
        {
          trace: { id: "old-trace", embedding: [0.1, 0.2, 0.3] },
          similarity: 0.85,
        },
      ]);

      await registry.recordDecision({
        intent: {
          description: "Test",
          createdAt: new Date().toISOString(),
        },
        constraints: [],
        action: {
          description: "Test",
          outcome: "pending",
          createdAt: new Date().toISOString(),
        },
        justification: { description: "Test", confidence: 0.5 },
        project: "test_project",
        tenant: "test",
        status: "captured",
      });

      expect(store.createPrecedentLink).toHaveBeenCalledWith(
        "trace-1",
        "old-trace",
        0.85
      );
    });
  });
});
