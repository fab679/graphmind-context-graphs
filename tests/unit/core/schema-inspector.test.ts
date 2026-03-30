import { describe, it, expect, vi, beforeEach } from "vitest";
import { formatSchemaForPrompt, createSchemaInspectorTool, createGraphQueryTool } from "../../../src/core/schema-inspector.js";
import type { SchemaOverview } from "../../../src/types/data-model.js";

// ── formatSchemaForPrompt ────────────────────────────────────────────────────

describe("formatSchemaForPrompt", () => {
  it("should return empty string for empty schema", () => {
    const schema: SchemaOverview = {
      nodeLabels: [],
      relationshipTypes: [],
      nodeCounts: {},
      edgeCounts: {},
    };
    expect(formatSchemaForPrompt(schema)).toBe("");
  });

  it("should format node labels with counts", () => {
    const schema: SchemaOverview = {
      nodeLabels: ["DecisionTrace", "Intent"],
      relationshipTypes: ["HAS_INTENT"],
      nodeCounts: { DecisionTrace: 5, Intent: 3 },
      edgeCounts: { HAS_INTENT: 3 },
    };
    const result = formatSchemaForPrompt(schema);
    expect(result).toContain("DecisionTrace (5 nodes)");
    expect(result).toContain("Intent (3 nodes)");
    expect(result).toContain("HAS_INTENT (3 edges)");
  });

  it("should include section header about Graph Schema", () => {
    const schema: SchemaOverview = {
      nodeLabels: ["CodeFile"],
      relationshipTypes: ["IMPORTS"],
      nodeCounts: { CodeFile: 1 },
      edgeCounts: { IMPORTS: 0 },
    };
    const result = formatSchemaForPrompt(schema);
    expect(result).toContain("## Your Brain Map");
    expect(result).toContain("Entity Types");
    expect(result).toContain("Relationship Types");
  });

  it("should default missing counts to 0", () => {
    const schema: SchemaOverview = {
      nodeLabels: ["Orphan"],
      relationshipTypes: ["MISSING_COUNT"],
      nodeCounts: {},
      edgeCounts: {},
    };
    const result = formatSchemaForPrompt(schema);
    expect(result).toContain("Orphan (0 nodes)");
    expect(result).toContain("MISSING_COUNT (0 edges)");
  });
});

// ── createSchemaInspectorTool ────────────────────────────────────────────────

describe("createSchemaInspectorTool", () => {
  let mockStore: any;

  beforeEach(() => {
    mockStore = {
      getSchemaOverview: vi.fn(),
    };
  });

  it("should return a tool with name 'inspect_schema'", () => {
    const tool = createSchemaInspectorTool(mockStore);
    expect(tool.name).toBe("inspect_schema");
  });

  it("should return discovery message when graph is empty", async () => {
    mockStore.getSchemaOverview.mockResolvedValue({
      nodeLabels: [],
      relationshipTypes: [],
      nodeCounts: {},
      edgeCounts: {},
    });

    const tool = createSchemaInspectorTool(mockStore);
    const result = await tool.invoke({});
    expect(result).toContain("empty");
    expect(result).toContain("discovery mode");
  });

  it("should format schema with entity types and guidelines when not empty", async () => {
    mockStore.getSchemaOverview.mockResolvedValue({
      nodeLabels: ["DecisionTrace", "CodeFile"],
      relationshipTypes: ["HAS_INTENT", "IMPORTS"],
      nodeCounts: { DecisionTrace: 10, CodeFile: 4 },
      edgeCounts: { HAS_INTENT: 10, IMPORTS: 2 },
    });

    const tool = createSchemaInspectorTool(mockStore);
    const result = await tool.invoke({});
    expect(result).toContain("DecisionTrace");
    expect(result).toContain("10 node(s)");
    expect(result).toContain("CodeFile");
    expect(result).toContain("IMPORTS");
    expect(result).toContain("Guidelines");
    expect(result).toContain("PascalCase");
    expect(result).toContain("UPPER_SNAKE_CASE");
  });
});

// ── createGraphQueryTool ─────────────────────────────────────────────────────

describe("createGraphQueryTool", () => {
  let mockStore: any;
  let mockClient: any;

  beforeEach(() => {
    mockClient = {
      queryReadonly: vi.fn(),
    };
    mockStore = {
      getClient: vi.fn().mockReturnValue(mockClient),
      getGraphName: vi.fn().mockReturnValue("cg_test"),
    };
  });

  it("should return a tool with name 'query_graph'", () => {
    const tool = createGraphQueryTool(mockStore);
    expect(tool.name).toBe("query_graph");
  });

  it("should return 'No results found' for empty result set", async () => {
    mockClient.queryReadonly.mockResolvedValue({ records: [], columns: [] });

    const tool = createGraphQueryTool(mockStore);
    const result = await tool.invoke({
      query: "MATCH (n) RETURN n LIMIT 1",
      description: "test query",
    });
    expect(result).toContain("No results found");
  });

  it("should format results with column names and row values", async () => {
    mockClient.queryReadonly.mockResolvedValue({
      records: [["alice", 42], ["bob", 37]],
      columns: ["name", "age"],
    });

    const tool = createGraphQueryTool(mockStore);
    const result = await tool.invoke({
      query: "MATCH (n:Person) RETURN n.name, n.age",
      description: "get people",
    });
    expect(result).toContain("2 rows");
    expect(result).toContain("name: alice");
    expect(result).toContain("age: 42");
    expect(result).toContain("name: bob");
  });

  it("should handle null values in results", async () => {
    mockClient.queryReadonly.mockResolvedValue({
      records: [["test", null]],
      columns: ["name", "email"],
    });

    const tool = createGraphQueryTool(mockStore);
    const result = await tool.invoke({
      query: "MATCH (n) RETURN n.name, n.email",
      description: "find null",
    });
    expect(result).toContain("email: null");
  });

  it("should handle object values by serializing to JSON", async () => {
    mockClient.queryReadonly.mockResolvedValue({
      records: [[{ nested: "value" }]],
      columns: ["data"],
    });

    const tool = createGraphQueryTool(mockStore);
    const result = await tool.invoke({
      query: "MATCH (n) RETURN n",
      description: "nested data",
    });
    expect(result).toContain('"nested":"value"');
  });

  it("should return error message on query failure", async () => {
    mockClient.queryReadonly.mockRejectedValue(new Error("Syntax error"));

    const tool = createGraphQueryTool(mockStore);
    const result = await tool.invoke({
      query: "INVALID CYPHER",
      description: "bad query",
    });
    expect(result).toContain("Query failed");
    expect(result).toContain("Syntax error");
  });

  it("should pass query to client with correct graph name", async () => {
    mockClient.queryReadonly.mockResolvedValue({ records: [], columns: [] });

    const tool = createGraphQueryTool(mockStore);
    await tool.invoke({
      query: "MATCH (n) RETURN n",
      description: "test",
    });

    expect(mockClient.queryReadonly).toHaveBeenCalledWith(
      "MATCH (n) RETURN n",
      "cg_test"
    );
  });
});
