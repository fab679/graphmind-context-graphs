import { describe, it, expect, vi, beforeEach } from "vitest";
import { KnowledgeLifecycleManager } from "../../../src/core/knowledge-lifecycle.js";
import type { ContextGraphConfig } from "../../../src/types/config.js";

function createMockStore() {
  return {
    getTraceById: vi.fn(),
    updateTraceConfidence: vi.fn().mockResolvedValue(undefined),
    updateTraceStatus: vi.fn().mockResolvedValue(undefined),
    updateTraceStatusAndConfidence: vi.fn().mockResolvedValue(undefined),
    getCandidatesForSynthesis: vi.fn().mockResolvedValue([]),
    getCandidatesForPruning: vi.fn().mockResolvedValue([]),
    getLifecycleStats: vi.fn().mockResolvedValue({
      captured: 0,
      validated: 0,
      synthesized: 0,
      antiPatterns: 0,
      pruned: 0,
      total: 0,
    }),
  } as any;
}

const config: ContextGraphConfig = {
  graphmind: { url: "http://localhost:8080" },
  tenant: "test",
  project: "test_project",
  embedding: {
    provider: {
      embed: async () => [],
      embedBatch: async () => [],
      dimensions: 3,
    },
    dimensions: 3,
  },
  debug: false,
};

describe("KnowledgeLifecycleManager", () => {
  let manager: KnowledgeLifecycleManager;
  let store: ReturnType<typeof createMockStore>;

  beforeEach(() => {
    store = createMockStore();
    manager = new KnowledgeLifecycleManager(store, config);
  });

  describe("validateTrace", () => {
    it("should increase confidence on success", async () => {
      store.getTraceById.mockResolvedValue({
        id: "1",
        justification: { confidence: 0.5 },
      });

      await manager.validateTrace("1", {
        traceId: "1",
        success: true,
      });

      expect(store.updateTraceStatusAndConfidence).toHaveBeenCalledWith(
        "1",
        "validated",
        0.6
      );
    });

    it("should decrease confidence on failure", async () => {
      store.getTraceById.mockResolvedValue({
        id: "1",
        justification: { confidence: 0.5 },
      });

      await manager.validateTrace("1", {
        traceId: "1",
        success: false,
      });

      expect(store.updateTraceStatusAndConfidence).toHaveBeenCalledWith(
        "1",
        "validated",
        0.35
      );
    });

    it("should cap confidence at 1.0", async () => {
      store.getTraceById.mockResolvedValue({
        id: "1",
        justification: { confidence: 0.95 },
      });

      await manager.validateTrace("1", {
        traceId: "1",
        success: true,
      });

      expect(store.updateTraceStatusAndConfidence).toHaveBeenCalledWith(
        "1",
        "validated",
        1
      );
    });

    it("should floor confidence at 0.0", async () => {
      store.getTraceById.mockResolvedValue({
        id: "1",
        justification: { confidence: 0.05 },
      });

      await manager.validateTrace("1", {
        traceId: "1",
        success: false,
      });

      expect(store.updateTraceStatusAndConfidence).toHaveBeenCalledWith(
        "1",
        "validated",
        0
      );
    });

    it("should throw for non-existent trace", async () => {
      store.getTraceById.mockResolvedValue(null);

      await expect(
        manager.validateTrace("999", { traceId: "999", success: true })
      ).rejects.toThrow("Trace not found: 999");
    });
  });

  describe("synthesizeRules", () => {
    it("should promote high-confidence validated traces", async () => {
      store.getCandidatesForSynthesis.mockResolvedValue([
        { id: "1", justification: { confidence: 0.9 } },
        { id: "2", justification: { confidence: 0.8 } },
      ]);

      const promoted = await manager.synthesizeRules();

      expect(promoted).toEqual(["1", "2"]);
      expect(store.updateTraceStatus).toHaveBeenCalledWith(
        "1",
        "synthesized"
      );
      expect(store.updateTraceStatus).toHaveBeenCalledWith(
        "2",
        "synthesized"
      );
    });

    it("should return empty when no candidates", async () => {
      const promoted = await manager.synthesizeRules();
      expect(promoted).toEqual([]);
    });
  });

  describe("pruneFailures", () => {
    it("should mark low-confidence traces as anti-patterns", async () => {
      store.getCandidatesForPruning.mockResolvedValue(["3", "4"]);

      const pruned = await manager.pruneFailures();

      expect(pruned).toEqual(["3", "4"]);
      expect(store.updateTraceStatus).toHaveBeenCalledWith(
        "3",
        "anti_pattern"
      );
      expect(store.updateTraceStatus).toHaveBeenCalledWith(
        "4",
        "anti_pattern"
      );
    });
  });

  describe("getLifecycleStats", () => {
    it("should return stats from store", async () => {
      store.getLifecycleStats.mockResolvedValue({
        captured: 5,
        validated: 3,
        synthesized: 1,
        antiPatterns: 1,
        pruned: 0,
        total: 10,
      });

      const stats = await manager.getLifecycleStats();
      expect(stats.total).toBe(10);
      expect(stats.captured).toBe(5);
      expect(stats.synthesized).toBe(1);
    });
  });
});
