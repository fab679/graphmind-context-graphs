import { tool } from "langchain";
import { z } from "zod";
import type { GraphmindStore } from "../db/client.js";

/**
 * Creates a `create_entity` tool that lets agents create arbitrary entities
 * in the context graph — building their "brain map" over time.
 *
 * Agents should use `inspect_schema` first to understand what already exists,
 * then create new entity types only when genuinely new concepts are discovered.
 *
 * Examples of entities agents might create:
 * - A coding agent: CodeFile, Function, APIEndpoint, Dependency, BugReport
 * - A legal agent: Contract, Clause, Regulation, CaseReference
 * - A medical agent: Condition, Medication, Symptom, LabResult
 */
export function createEntityTool(store: GraphmindStore) {
  return tool(
    async (input) => {
      const now = new Date().toISOString();
      const agentName = store.getAgentName();
      const { label, reason, properties: explicitProps, ...extraKeys } = input as any;

      // LLMs often pass properties as top-level args instead of inside `properties`.
      // Collect any extra keys (path, name, decision, etc.) into the properties object.
      const props: Record<string, string | number | boolean> = {
        ...(explicitProps ?? {}),
      };
      for (const [key, val] of Object.entries(extraKeys)) {
        if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
          props[key] = val;
        }
      }

      try {
        const allProps = { ...props };
        if (reason) allProps._reason = reason;

        const entityId = await store.createEntity({
          label,
          properties: allProps,
          createdBy: agentName,
          createdAt: now,
        });

        return `Entity created: ${label} (id: ${entityId}). Properties: ${JSON.stringify(props)}. This entity is now part of your context graph and can be referenced in relationships.`;
      } catch (err) {
        return `Failed to create entity: ${(err as Error).message}. Check that the label is valid (PascalCase, no special characters).`;
      }
    },
    {
      name: "create_entity",
      description:
        "Create a new entity (node) in the context graph to map your understanding of the domain. " +
        "Use this to record domain concepts, objects, or artifacts you discover while working. " +
        "Always use `inspect_schema` first to check if a similar entity type already exists. " +
        "Labels should be PascalCase (e.g., CodeFile, APIEndpoint, Contract). " +
        "Pass entity properties directly as named arguments (e.g., path, name, decision).",
      schema: z.object({
        label: z
          .string()
          .describe("PascalCase node label (e.g., 'CodeFile', 'APIEndpoint', 'Contract', 'Symptom')"),
        reason: z
          .string()
          .optional()
          .describe("Why you are creating this entity — what understanding does it capture?"),
      }).passthrough(),
    }
  );
}

/**
 * Creates a `create_relationship` tool that lets agents connect entities
 * in the context graph with meaningful relationships.
 *
 * Examples:
 * - (CodeFile)-[:IMPORTS]->(CodeFile)
 * - (Function)-[:HANDLES]->(ErrorType)
 * - (Contract)-[:GOVERNED_BY]->(Regulation)
 * - (Symptom)-[:INDICATES]->(Condition)
 */
export function createRelationshipTool(store: GraphmindStore) {
  return tool(
    async ({ source_id, target_id, relationship_type, properties, reason }) => {
      const now = new Date().toISOString();
      const agentName = store.getAgentName();

      try {
        const relProps: Record<string, string | number | boolean> = { ...properties };
        if (reason) relProps._reason = reason;

        await store.createRelationship({
          sourceId: source_id,
          targetId: target_id,
          type: relationship_type,
          properties: relProps,
          createdBy: agentName,
          createdAt: now,
        });

        return `Relationship created: (${source_id})-[:${relationship_type}]->(${target_id}). This connection is now part of your context graph.`;
      } catch (err) {
        return `Failed to create relationship: ${(err as Error).message}. Verify that both source and target IDs exist.`;
      }
    },
    {
      name: "create_relationship",
      description:
        "Create a relationship between two existing entities in the context graph. " +
        "Use this to map connections, dependencies, and associations between domain concepts. " +
        "Relationship types should be UPPER_SNAKE_CASE (e.g., IMPORTS, DEPENDS_ON, TREATS, GOVERNED_BY).",
      schema: z.object({
        source_id: z.string().describe("The node ID of the source entity"),
        target_id: z.string().describe("The node ID of the target entity"),
        relationship_type: z
          .string()
          .describe("UPPER_SNAKE_CASE relationship type (e.g., 'IMPORTS', 'DEPENDS_ON', 'TREATS')"),
        properties: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Optional properties on the relationship edge"),
        reason: z
          .string()
          .optional()
          .describe("Why this relationship exists — what connection does it capture?"),
      }),
    }
  );
}

/**
 * Creates a `find_entities` tool for searching existing entities by label and properties.
 */
export function createFindEntitiesTool(store: GraphmindStore) {
  return tool(
    async ({ label, filter }) => {
      try {
        const entities = await store.findEntities(label, filter as Record<string, string | number | boolean> | undefined);

        if (entities.length === 0) {
          return `No ${label} entities found${filter ? ` matching ${JSON.stringify(filter)}` : ""}. Use create_entity to add one.`;
        }

        const items = entities.map((e) => {
          const props = Object.entries(e.properties)
            .filter(([k]) => !k.startsWith("_"))
            .map(([k, v]) => `${k}: ${v}`)
            .join(", ");
          return `- id: ${e.id} | ${props}`;
        });

        return `Found ${entities.length} ${label} entit${entities.length === 1 ? "y" : "ies"}:\n${items.join("\n")}`;
      } catch (err) {
        return `Search failed: ${(err as Error).message}`;
      }
    },
    {
      name: "find_entities",
      description:
        "Search for existing entities in the context graph by label and optional property filter. " +
        "Use this to find entities before creating duplicates or to look up IDs for creating relationships.",
      schema: z.object({
        label: z.string().describe("The entity label to search for (e.g., 'CodeFile', 'Contract')"),
        filter: z
          .record(z.string(), z.union([z.string(), z.number(), z.boolean()]))
          .optional()
          .describe("Optional property filter (e.g., {name: 'auth.ts'})"),
      }),
    }
  );
}
