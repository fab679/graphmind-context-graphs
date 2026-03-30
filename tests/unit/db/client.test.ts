import { describe, it, expect, vi, beforeEach } from "vitest";
import { GraphmindStore } from "../../../src/db/client.js";
import type { ContextGraphConfig } from "../../../src/types/config.js";

// Mock graphmind-sdk
const mockQuery = vi.fn().mockResolvedValue({ records: [[1]], columns: ["traceId"] });
const mockQueryReadonly = vi.fn().mockResolvedValue({ records: [], columns: [] });
const mockSchema = vi.fn().mockResolvedValue({ node_types: [], edge_types: [] });

vi.mock("graphmind-sdk", () => {
  const GraphmindClient = class {
    query = mockQuery;
    queryReadonly = mockQueryReadonly;
    schema = mockSchema;
    constructor(_opts: any) {}
  };
  return { GraphmindClient };
});

function createTestConfig(overrides?: Partial<ContextGraphConfig>): ContextGraphConfig {
  return {
    graphmind: { url: "http://localhost:8080" },
    tenant: "test_tenant",
    project: "test_project",
    agent: "test-agent",
    embedding: {
      provider: {
        embed: async () => [0.1, 0.2, 0.3],
        embedBatch: async (texts: string[]) => texts.map(() => [0.1, 0.2, 0.3]),
        dimensions: 3,
      },
      dimensions: 3,
    },
    debug: false,
    ...overrides,
  };
}

describe("GraphmindStore", () => {
  let store: GraphmindStore;

  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockResolvedValue({ records: [[1]], columns: ["traceId"] });
    mockQueryReadonly.mockResolvedValue({ records: [], columns: [] });
    mockSchema.mockResolvedValue({ node_types: [], edge_types: [] });
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

  // ── Accessor methods ─────────────────────────────────────────────────────

  describe("getProject / getTenant / getAgentName", () => {
    it("should return the configured project", () => {
      expect(store.getProject()).toBe("test_project");
    });

    it("should return the configured tenant", () => {
      expect(store.getTenant()).toBe("test_tenant");
    });

    it("should return the configured agent name", () => {
      expect(store.getAgentName()).toBe("test-agent");
    });

    it("should return undefined agent name when not configured", () => {
      const noAgentStore = new GraphmindStore(
        createTestConfig({ agent: undefined })
      );
      expect(noAgentStore.getAgentName()).toBeUndefined();
    });
  });

  // ── Schema overview ──────────────────────────────────────────────────────

  describe("getSchemaOverview", () => {
    it("should return empty schema when agent has no data", async () => {
      // 2 UNION ALL queries both return empty
      mockQueryReadonly
        .mockResolvedValueOnce({ records: [], columns: [] })
        .mockResolvedValueOnce({ records: [], columns: [] });

      const schema = await store.getSchemaOverview();
      expect(schema.nodeLabels).toEqual([]);
      expect(schema.relationshipTypes).toEqual([]);
      expect(schema.nodeCounts).toEqual({});
      expect(schema.edgeCounts).toEqual({});
    });

    it("should return only domain entities, filtering framework types", async () => {
      // 2 UNION ALL queries: 1 node query + 1 rel query
      mockQueryReadonly
        .mockResolvedValueOnce({
          records: [[["CodeFile"], 2], [["DecisionTrace"], 3], [["DesignDecision"], 1]],
          columns: ["nodeLabels", "cnt"],
        })  // node query (UNION ALL)
        .mockResolvedValueOnce({
          records: [["IMPORTS", 2], ["GOVERNED_BY", 1], ["HAS_INTENT", 3]],
          columns: ["relType", "cnt"],
        });  // rel query (UNION ALL)

      const schema = await store.getSchemaOverview();
      // Domain entities visible
      expect(schema.nodeLabels).toContain("CodeFile");
      expect(schema.nodeLabels).toContain("DesignDecision");
      expect(schema.relationshipTypes).toContain("IMPORTS");
      expect(schema.relationshipTypes).toContain("GOVERNED_BY");
      // Framework types filtered out
      expect(schema.nodeLabels).not.toContain("DecisionTrace");
      expect(schema.relationshipTypes).not.toContain("HAS_INTENT");
      expect(schema.nodeCounts["CodeFile"]).toBe(2);
      expect(schema.edgeCounts["IMPORTS"]).toBe(2);
    });

    it("should exclude internal structural types from schema", async () => {
      // 2 UNION ALL queries: 1 node query + 1 rel query
      mockQueryReadonly
        .mockResolvedValueOnce({
          records: [[["CodeFile"], 5], [["Agent"], 1], [["Project"], 1]],
          columns: ["nodeLabels", "cnt"],
        })  // node query (UNION ALL)
        .mockResolvedValueOnce({
          records: [["IMPORTS", 3], ["CREATED_BY", 5], ["MEMBER_OF", 1], ["BELONGS_TO_PROJECT", 5]],
          columns: ["relType", "cnt"],
        });  // rel query (UNION ALL)

      const schema = await store.getSchemaOverview();
      expect(schema.nodeLabels).not.toContain("Agent");
      expect(schema.nodeLabels).not.toContain("Project");
      expect(schema.nodeLabels).toContain("CodeFile");
      expect(schema.relationshipTypes).not.toContain("MEMBER_OF");
      expect(schema.relationshipTypes).not.toContain("BELONGS_TO_PROJECT");
      expect(schema.relationshipTypes).not.toContain("CREATED_BY");
      expect(schema.relationshipTypes).toContain("IMPORTS");
    });

    it("should return empty schema on error", async () => {
      mockQueryReadonly
        .mockRejectedValueOnce(new Error("Connection lost"))
        .mockRejectedValueOnce(new Error("Connection lost"));

      const schema = await store.getSchemaOverview();
      expect(schema.nodeLabels).toEqual([]);
      expect(schema.relationshipTypes).toEqual([]);
    });

    it("should fall back to project-scoped schema when no agent configured", async () => {
      const storeNoAgent = new GraphmindStore(createTestConfig({ agent: undefined }));

      // Project-scoped also uses 2 queries (node + rel)
      mockQueryReadonly
        .mockResolvedValueOnce({
          records: [[["CodeFile"], 5], [["DecisionTrace"], 10]],
          columns: ["nodeLabels", "cnt"],
        })
        .mockResolvedValueOnce({
          records: [["IMPORTS", 3], ["HAS_INTENT", 10]],
          columns: ["relType", "cnt"],
        });

      const schema = await storeNoAgent.getSchemaOverview();
      expect(schema.nodeLabels).toContain("CodeFile");
      expect(schema.nodeLabels).not.toContain("DecisionTrace");
      // Verify queryReadonly was called (not schema())
      expect(mockQueryReadonly).toHaveBeenCalled();
      expect(mockSchema).not.toHaveBeenCalled();
    });
  });

  // ── Dynamic entity management ────────────────────────────────────────────

  describe("createEntity", () => {
    it("should create an entity and return its id", async () => {
      mockQuery.mockResolvedValue({ records: [[42]], columns: ["entityId"] });

      const id = await store.createEntity({
        label: "CodeFile",
        properties: { name: "auth.ts", path: "/src/auth.ts" },
        createdBy: "test-agent",
        createdAt: "2025-01-01T00:00:00Z",
      });

      expect(id).toBe("42");
      // Should have called query at least once for CREATE
      expect(mockQuery).toHaveBeenCalled();
    });

    it("should throw on query failure", async () => {
      mockQuery.mockRejectedValue(new Error("Invalid label"));

      await expect(
        store.createEntity({
          label: "Bad!Label",
          properties: {},
          createdAt: "2025-01-01T00:00:00Z",
        })
      ).rejects.toThrow("Invalid label");
    });
  });

  describe("createRelationship", () => {
    it("should create a relationship between two nodes", async () => {
      mockQuery.mockResolvedValue({ records: [], columns: [] });

      await expect(
        store.createRelationship({
          sourceId: "1",
          targetId: "2",
          type: "IMPORTS",
          properties: { weight: 0.9 },
          createdBy: "test-agent",
          createdAt: "2025-01-01T00:00:00Z",
        })
      ).resolves.toBeUndefined();

      expect(mockQuery).toHaveBeenCalled();
    });

    it("should throw on relationship creation failure", async () => {
      mockQuery.mockRejectedValue(new Error("Node not found"));

      await expect(
        store.createRelationship({
          sourceId: "999",
          targetId: "1",
          type: "DEPENDS_ON",
          createdAt: "2025-01-01T00:00:00Z",
        })
      ).rejects.toThrow("Node not found");
    });
  });

  describe("findEntities", () => {
    it("should return empty array when no entities found", async () => {
      mockQueryReadonly.mockResolvedValue({ records: [], columns: [] });

      const entities = await store.findEntities("CodeFile");
      expect(entities).toEqual([]);
    });

    it("should return parsed entities from query results", async () => {
      mockQueryReadonly.mockResolvedValue({
        records: [
          [{ id: 1, properties: { name: "auth.ts", createdAt: "2025-01-01", createdBy: "agent" } }],
          [{ id: 2, properties: { name: "utils.ts", createdAt: "2025-01-02" } }],
        ],
        columns: ["n"],
      });

      const entities = await store.findEntities("CodeFile");
      expect(entities).toHaveLength(2);
      expect(entities[0].label).toBe("CodeFile");
    });

    it("should return empty array on query failure", async () => {
      mockQueryReadonly.mockRejectedValue(new Error("Query failed"));

      const entities = await store.findEntities("CodeFile");
      expect(entities).toEqual([]);
    });
  });

  describe("getConnectedEntities", () => {
    it("should return empty array when no connections found", async () => {
      mockQueryReadonly.mockResolvedValue({ records: [], columns: [] });

      const connected = await store.getConnectedEntities("1");
      expect(connected).toEqual([]);
    });

    it("should return connected entities with relationship info", async () => {
      mockQueryReadonly.mockResolvedValue({
        records: [
          [
            { id: 2, labels: ["CodeFile"], properties: { name: "utils.ts", createdAt: "2025-01-01" } },
            "IMPORTS",
            "outgoing",
          ],
        ],
        columns: ["m", "relType", "dir"],
      });

      const connected = await store.getConnectedEntities("1", "outgoing");
      expect(connected).toHaveLength(1);
      expect(connected[0].relationship).toBe("IMPORTS");
      expect(connected[0].direction).toBe("outgoing");
      expect(connected[0].entity.label).toBe("CodeFile");
    });

    it("should return empty array on query failure", async () => {
      mockQueryReadonly.mockRejectedValue(new Error("DB error"));

      const connected = await store.getConnectedEntities("1");
      expect(connected).toEqual([]);
    });
  });
});
