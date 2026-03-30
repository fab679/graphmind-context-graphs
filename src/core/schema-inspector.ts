import { tool } from "langchain";
import { z } from "zod";
import type { GraphmindStore } from "../db/client.js";
import type { SchemaOverview } from "../types/data-model.js";

/**
 * Format a SchemaOverview into a human-readable summary for prompt injection.
 */
export function formatSchemaForPrompt(schema: SchemaOverview): string {
  if (schema.nodeLabels.length === 0) {
    return "";
  }

  const nodeLines = schema.nodeLabels
    .map((label) => `  - ${label} (${schema.nodeCounts[label] ?? 0} nodes)`)
    .join("\n");

  const relLines = schema.relationshipTypes
    .map((type) => `  - ${type} (${schema.edgeCounts[type] ?? 0} edges)`)
    .join("\n");

  return `## Your Brain Map (Context Graph Schema)
These are the entity types and relationships you have created or produced.
Use this to understand what you already know and build on it coherently.

**Entity Types:**
${nodeLines}

**Relationship Types:**
${relLines}`;
}

/**
 * Creates an `inspect_schema` tool that agents can use to understand
 * the current state of their own context graph — what entities and relationships
 * they have created or produced.
 *
 * The schema is scoped to the agent: each agent only sees its own entities
 * and decision traces. This ensures the schema injected into the system prompt
 * guides only the agent that owns the context, without leaking other agents' structures.
 *
 * Critical for preventing ambiguity: agents should check the schema
 * before creating new entity types to avoid duplicating existing structures.
 */
export function createSchemaInspectorTool(store: GraphmindStore) {
  return tool(
    async () => {
      const schema = await store.getSchemaOverview();

      if (schema.nodeLabels.length === 0) {
        return "The context graph is empty — no entities or relationships exist yet. You are in discovery mode. As you work, use `create_entity` and `create_relationship` to build your understanding of the domain.";
      }

      const sections: string[] = [];

      sections.push("# Your Context Graph Schema\n");

      sections.push("## Entity Types (Node Labels)");
      for (const label of schema.nodeLabels) {
        sections.push(`- **${label}**: ${schema.nodeCounts[label] ?? 0} node(s)`);
      }

      sections.push("\n## Relationship Types");
      for (const type of schema.relationshipTypes) {
        sections.push(`- **${type}**: ${schema.edgeCounts[type] ?? 0} edge(s)`);
      }

      sections.push("\n## Guidelines");
      sections.push("- Before creating a new entity type, check if a similar one already exists above.");
      sections.push("- Use existing relationship types when they fit. Only create new types for genuinely new patterns.");
      sections.push("- Entity labels should be PascalCase (e.g., `CodeFile`, `APIEndpoint`).");
      sections.push("- Relationship types should be UPPER_SNAKE_CASE (e.g., `DEPENDS_ON`, `IMPORTS`).");

      return sections.join("\n");
    },
    {
      name: "inspect_schema",
      description:
        "Inspect your own context graph schema to see what entity types and relationships you have created. " +
        "Only shows entities and traces you produced — other agents' structures are not visible. " +
        "Use this before creating new entities to avoid duplicating existing structures.",
      schema: z.object({}),
    }
  );
}

/**
 * Creates a `query_graph` tool for freeform Cypher read queries.
 * This lets agents explore their context graph to understand what they've built.
 */
export function createGraphQueryTool(store: GraphmindStore) {
  return tool(
    async ({ query, description }) => {
      try {
        const result = await store.getClient().queryReadonly(
          query,
          store.getGraphName()
        );

        if (!result.records || result.records.length === 0) {
          return "No results found.";
        }

        // Format results as readable text
        const columns = result.columns ?? [];
        const rows = result.records.map((record: unknown[]) => {
          return columns.map((col: string, i: number) => {
            const val = record[i];
            if (val === null || val === undefined) return `${col}: null`;
            if (typeof val === "object") return `${col}: ${JSON.stringify(val)}`;
            return `${col}: ${val}`;
          }).join(" | ");
        });

        return `Results (${result.records.length} rows):\n${rows.join("\n")}`;
      } catch (err) {
        return `Query failed: ${(err as Error).message}. Ensure your Cypher syntax is correct and only uses read operations (MATCH, RETURN, etc.).`;
      }
    },
    {
      name: "query_graph",
      description:
        "Execute a read-only Cypher query against the context graph to explore entities and relationships. " +
        "Use MATCH patterns to find specific nodes and traverse relationships. " +
        "Only read queries are allowed (no CREATE, DELETE, SET).",
      schema: z.object({
        query: z.string().describe("A Cypher read query (MATCH...RETURN). Do not use CREATE, DELETE, or SET."),
        description: z.string().describe("Brief description of what this query is looking for"),
      }),
    }
  );
}
