import type { GraphmindClient } from "graphmind-sdk";
import type { Logger } from "../utils/logger.js";
import { SCHEMA_QUERIES } from "./queries.js";

export async function bootstrapSchema(
  client: GraphmindClient,
  graph: string,
  dimensions: number,
  metric: string,
  logger: Logger
): Promise<void> {
  logger.info("Bootstrapping schema for graph: %s", graph);

  // Create property indexes
  const indexQueries = [
    SCHEMA_QUERIES.createIntentIndex,
    SCHEMA_QUERIES.createConstraintIndex,
    SCHEMA_QUERIES.createActionIndex,
    SCHEMA_QUERIES.createTraceIndex,
    SCHEMA_QUERIES.createProjectIndex,
    SCHEMA_QUERIES.createDomainIndex,
    SCHEMA_QUERIES.createConceptIndex,
    SCHEMA_QUERIES.createToolIndex,
    SCHEMA_QUERIES.createAgentIndex,
    SCHEMA_QUERIES.createSkillIndex,
  ];

  for (const query of indexQueries) {
    try {
      await client.query(query, graph);
    } catch (err) {
      logger.debug("Index may already exist: %s", (err as Error).message);
    }
  }

  // Create vector indexes
  const vectorQueries = [
    SCHEMA_QUERIES.createIntentVectorIndex(dimensions, metric),
    SCHEMA_QUERIES.createTraceVectorIndex(dimensions, metric),
    SCHEMA_QUERIES.createConceptVectorIndex(dimensions, metric),
  ];

  for (const query of vectorQueries) {
    try {
      await client.query(query, graph);
    } catch (err) {
      logger.debug(
        "Vector index may already exist: %s",
        (err as Error).message
      );
    }
  }

  logger.info("Schema bootstrap complete");
}
