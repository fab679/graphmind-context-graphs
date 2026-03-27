import type { ContextGraphConfig } from "../types/config.js";
import {
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_VECTOR_SEARCH_LIMIT,
} from "../types/config.js";
import type {
  DecisionTrace,
  FormattedContext,
  ScoredDecisionTrace,
} from "../types/data-model.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import type { GraphmindStore } from "../db/client.js";
import { createLogger, type Logger } from "../utils/logger.js";

export class ContextualRegistry {
  private store: GraphmindStore;
  private embeddingProvider: EmbeddingProvider;
  private config: ContextGraphConfig;
  private logger: Logger;
  private discoveryMode: boolean | null = null;

  constructor(
    store: GraphmindStore,
    embeddingProvider: EmbeddingProvider,
    config: ContextGraphConfig
  ) {
    this.store = store;
    this.embeddingProvider = embeddingProvider;
    this.config = config;
    this.logger = createLogger(config.debug);
  }

  async isDiscoveryMode(): Promise<boolean> {
    if (this.discoveryMode !== null) return this.discoveryMode;
    const count = await this.store.countTraces();
    this.discoveryMode = count === 0;
    if (this.discoveryMode) {
      this.logger.info("Discovery Mode: no prior traces found for this project");
    }
    return this.discoveryMode;
  }

  async getRelevantContext(intentDescription: string): Promise<FormattedContext> {
    const embedding = await this.embeddingProvider.embed(intentDescription);
    const limit =
      this.config.vectorSearchLimit ?? DEFAULT_VECTOR_SEARCH_LIMIT;

    const pastTraces = await this.store.findSimilarTraces(embedding, limit);
    const rules = await this.store.getActiveRules();
    const antiPatterns = await this.store.getAntiPatterns();
    const skills = await this.store.getSkillsByProject();

    this.logger.debug(
      "Retrieved context: %d traces, %d rules, %d anti-patterns, %d skills",
      pastTraces.length,
      rules.length,
      antiPatterns.length,
      skills.length
    );

    return { pastTraces, rules, antiPatterns, skills };
  }

  async recordDecision(
    trace: Omit<DecisionTrace, "id" | "createdAt" | "updatedAt">
  ): Promise<string> {
    // Generate trace embedding from combined text
    const traceText = [
      `Intent: ${trace.intent.description}`,
      ...trace.constraints.map((c) => `Constraint (${c.type}): ${c.description}`),
      `Action: ${trace.action.description}`,
      `Justification: ${trace.justification.description}`,
    ].join("\n");

    const [traceEmbedding, intentEmbedding] = await this.embeddingProvider.embedBatch([
      traceText,
      trace.intent.description,
    ]);

    // Embed constraints and action
    const constraintTexts = trace.constraints.map((c) => c.description);
    const constraintEmbeddings =
      constraintTexts.length > 0
        ? await this.embeddingProvider.embedBatch(constraintTexts)
        : [];
    const [actionEmbedding] = await this.embeddingProvider.embedBatch([
      trace.action.description,
    ]);

    const enrichedTrace = {
      ...trace,
      embedding: traceEmbedding,
      intent: { ...trace.intent, embedding: intentEmbedding },
      constraints: trace.constraints.map((c, i) => ({
        ...c,
        embedding: constraintEmbeddings[i],
      })),
      action: { ...trace.action, embedding: actionEmbedding },
    };

    const traceId = await this.store.saveDecisionTrace(enrichedTrace);

    // Semantic generalization: link to similar past traces
    await this.linkPrecedents(traceId, traceEmbedding);

    // Reset discovery mode cache
    this.discoveryMode = null;

    this.logger.debug("Recorded decision trace: %s", traceId);
    return traceId;
  }

  private async linkPrecedents(
    newTraceId: string,
    embedding: number[]
  ): Promise<void> {
    const threshold =
      this.config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const similarTraces = await this.store.findSimilarTraces(embedding, 5);

    for (const { trace, similarity } of similarTraces) {
      if (trace.id && trace.id !== newTraceId && similarity >= threshold) {
        await this.store.createPrecedentLink(newTraceId, trace.id, similarity);
        this.logger.debug(
          "Linked trace %s -> %s (similarity: %.3f)",
          newTraceId,
          trace.id,
          similarity
        );
      }
    }
  }

  async findPrecedents(traceId: string): Promise<ScoredDecisionTrace[]> {
    const trace = await this.store.getTraceById(traceId);
    if (!trace?.embedding) return [];
    return this.store.findSimilarTraces(trace.embedding);
  }
}
