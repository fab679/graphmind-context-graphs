import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createEntityTool,
  createRelationshipTool,
  createFindEntitiesTool,
} from "../../../src/core/entity-builder.js";

describe("createEntityTool", () => {
  let mockStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = {
      getAgentName: vi.fn().mockReturnValue("test-agent"),
      createEntity: vi.fn().mockResolvedValue("42"),
    };
  });

  it("should return a tool with name 'create_entity'", () => {
    const tool = createEntityTool(mockStore);
    expect(tool.name).toBe("create_entity");
  });

  it("should create an entity and return confirmation with id", async () => {
    const tool = createEntityTool(mockStore);
    const result = await tool.invoke({
      label: "CodeFile",
      properties: { name: "auth.ts", path: "/src/auth.ts" },
      reason: "Tracking source files for dependency analysis",
    });

    expect(result).toContain("Entity created");
    expect(result).toContain("CodeFile");
    expect(result).toContain("42");
    expect(result).toContain("auth.ts");
  });

  it("should pass correct data to store.createEntity", async () => {
    const tool = createEntityTool(mockStore);
    await tool.invoke({
      label: "APIEndpoint",
      properties: { path: "/api/users", method: "GET" },
      reason: "Discovered during API exploration",
    });

    expect(mockStore.createEntity).toHaveBeenCalledTimes(1);
    const arg = mockStore.createEntity.mock.calls[0][0];
    expect(arg.label).toBe("APIEndpoint");
    expect(arg.properties.path).toBe("/api/users");
    expect(arg.properties.method).toBe("GET");
    expect(arg.properties._reason).toBe("Discovered during API exploration");
    expect(arg.createdBy).toBe("test-agent");
    expect(arg.createdAt).toBeDefined();
  });

  it("should return error message on failure", async () => {
    mockStore.createEntity.mockRejectedValue(new Error("Invalid label characters"));

    const tool = createEntityTool(mockStore);
    const result = await tool.invoke({
      label: "bad label!",
      properties: {},
      reason: "test",
    });

    expect(result).toContain("Failed to create entity");
    expect(result).toContain("Invalid label characters");
  });
});

describe("createRelationshipTool", () => {
  let mockStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = {
      getAgentName: vi.fn().mockReturnValue("test-agent"),
      createRelationship: vi.fn().mockResolvedValue(undefined),
    };
  });

  it("should return a tool with name 'create_relationship'", () => {
    const tool = createRelationshipTool(mockStore);
    expect(tool.name).toBe("create_relationship");
  });

  it("should create a relationship and return confirmation", async () => {
    const tool = createRelationshipTool(mockStore);
    const result = await tool.invoke({
      source_id: "1",
      target_id: "2",
      relationship_type: "IMPORTS",
      reason: "auth.ts imports utils.ts",
    });

    expect(result).toContain("Relationship created");
    expect(result).toContain("IMPORTS");
    expect(result).toContain("1");
    expect(result).toContain("2");
  });

  it("should pass correct data to store.createRelationship", async () => {
    const tool = createRelationshipTool(mockStore);
    await tool.invoke({
      source_id: "10",
      target_id: "20",
      relationship_type: "DEPENDS_ON",
      properties: { weight: 0.9 },
      reason: "Strong dependency found",
    });

    expect(mockStore.createRelationship).toHaveBeenCalledTimes(1);
    const arg = mockStore.createRelationship.mock.calls[0][0];
    expect(arg.sourceId).toBe("10");
    expect(arg.targetId).toBe("20");
    expect(arg.type).toBe("DEPENDS_ON");
    expect(arg.properties._reason).toBe("Strong dependency found");
    expect(arg.properties.weight).toBe(0.9);
    expect(arg.createdBy).toBe("test-agent");
    expect(arg.createdAt).toBeDefined();
  });

  it("should handle missing optional properties", async () => {
    const tool = createRelationshipTool(mockStore);
    await tool.invoke({
      source_id: "1",
      target_id: "2",
      relationship_type: "LINKS_TO",
      reason: "general link",
    });

    const arg = mockStore.createRelationship.mock.calls[0][0];
    expect(arg.properties._reason).toBe("general link");
  });

  it("should return error message on failure", async () => {
    mockStore.createRelationship.mockRejectedValue(new Error("Source not found"));

    const tool = createRelationshipTool(mockStore);
    const result = await tool.invoke({
      source_id: "999",
      target_id: "1",
      relationship_type: "DEPENDS_ON",
      reason: "test",
    });

    expect(result).toContain("Failed to create relationship");
    expect(result).toContain("Source not found");
  });
});

describe("createFindEntitiesTool", () => {
  let mockStore: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore = {
      findEntities: vi.fn().mockResolvedValue([]),
    };
  });

  it("should return a tool with name 'find_entities'", () => {
    const tool = createFindEntitiesTool(mockStore);
    expect(tool.name).toBe("find_entities");
  });

  it("should return 'no entities found' message when empty", async () => {
    const tool = createFindEntitiesTool(mockStore);
    const result = await tool.invoke({ label: "CodeFile" });

    expect(result).toContain("No CodeFile entities found");
    expect(result).toContain("create_entity");
  });

  it("should include filter info in empty result message", async () => {
    const tool = createFindEntitiesTool(mockStore);
    const result = await tool.invoke({
      label: "CodeFile",
      filter: { name: "missing.ts" },
    });

    expect(result).toContain("No CodeFile entities found");
    expect(result).toContain("missing.ts");
  });

  it("should format found entities with id and properties", async () => {
    mockStore.findEntities.mockResolvedValue([
      {
        id: "1",
        label: "CodeFile",
        properties: { name: "auth.ts", path: "/src/auth.ts", _reason: "internal" },
        createdAt: "2025-01-01",
      },
      {
        id: "2",
        label: "CodeFile",
        properties: { name: "utils.ts", path: "/src/utils.ts" },
        createdAt: "2025-01-02",
      },
    ]);

    const tool = createFindEntitiesTool(mockStore);
    const result = await tool.invoke({ label: "CodeFile" });

    expect(result).toContain("Found 2 CodeFile entities");
    expect(result).toContain("id: 1");
    expect(result).toContain("auth.ts");
    expect(result).toContain("id: 2");
    expect(result).toContain("utils.ts");
    // Internal properties prefixed with _ should be filtered
    expect(result).not.toContain("_reason");
  });

  it("should use singular 'entity' for single result", async () => {
    mockStore.findEntities.mockResolvedValue([
      {
        id: "1",
        label: "Contract",
        properties: { name: "NDA" },
        createdAt: "2025-01-01",
      },
    ]);

    const tool = createFindEntitiesTool(mockStore);
    const result = await tool.invoke({ label: "Contract" });

    expect(result).toContain("1 Contract entity");
    expect(result).not.toContain("entities");
  });

  it("should pass label and filter to store.findEntities", async () => {
    const tool = createFindEntitiesTool(mockStore);
    await tool.invoke({
      label: "APIEndpoint",
      filter: { method: "POST" },
    });

    expect(mockStore.findEntities).toHaveBeenCalledWith("APIEndpoint", { method: "POST" });
  });

  it("should return error message on failure", async () => {
    mockStore.findEntities.mockRejectedValue(new Error("Database unavailable"));

    const tool = createFindEntitiesTool(mockStore);
    const result = await tool.invoke({ label: "CodeFile" });

    expect(result).toContain("Search failed");
    expect(result).toContain("Database unavailable");
  });
});
