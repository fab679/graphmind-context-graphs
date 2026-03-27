import type { GraphmindClient } from "graphmind-sdk";
import type { ScoredDecisionTrace } from "../types/data-model.js";
import type { Logger } from "../utils/logger.js";
import { VECTOR_QUERIES } from "./queries.js";
import { reconstructTrace } from "./client.js";

export async function searchSimilarTraces(
  client: GraphmindClient,
  graph: string,
  queryVector: number[],
  project: string,
  topK: number,
  logger: Logger
): Promise<ScoredDecisionTrace[]> {
  // Graphmind SEARCH requires the vector as an inline literal, not a $param
  const vectorLiteral = `[${queryVector.join(", ")}]`;
  const query = VECTOR_QUERIES.searchSimilarTraces(vectorLiteral, topK);

  try {
    const result = await client.queryReadonly(query, graph, {
      project,
    });

    if (!result.records || result.records.length === 0) {
      return [];
    }

    return result.records.map((record: unknown[]) => {
      const trace = reconstructTrace(record);
      const similarity = record[4] as number;
      return { trace, similarity };
    });
  } catch (err) {
    logger.warn("Vector search failed: %s", (err as Error).message);
    return [];
  }
}

/** Search similar traces scoped to specific agents (for isolated/selective context sharing). */
export async function searchSimilarTracesByAgents(
  client: GraphmindClient,
  graph: string,
  queryVector: number[],
  project: string,
  agentNames: string[],
  topK: number,
  logger: Logger
): Promise<ScoredDecisionTrace[]> {
  const vectorLiteral = `[${queryVector.join(", ")}]`;
  const query = VECTOR_QUERIES.searchSimilarTracesByAgents(vectorLiteral, topK, agentNames);

  try {
    const result = await client.queryReadonly(query, graph, {
      project,
    });

    if (!result.records || result.records.length === 0) {
      return [];
    }

    return result.records.map((record: unknown[]) => {
      const trace = reconstructTrace(record);
      const similarity = record[4] as number;
      return { trace, similarity };
    });
  } catch (err) {
    logger.warn("Agent-scoped vector search failed: %s", (err as Error).message);
    return [];
  }
}
