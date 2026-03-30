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

    const [pastTraces, rules, antiPatterns, skills, schema] = await Promise.all([
      this.store.findSimilarTraces(embedding, limit),
      this.store.getActiveRules(),
      this.store.getAntiPatterns(),
      this.store.getSkillsByProject(),
      this.store.getSchemaOverview(),
    ]);

    this.logger.debug(
      "Retrieved context: %d traces, %d rules, %d anti-patterns, %d skills, %d entity types",
      pastTraces.length,
      rules.length,
      antiPatterns.length,
      skills.length,
      schema.nodeLabels.length
    );

    return { pastTraces, rules, antiPatterns, skills, schema };
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

    // Embed concept names and update concept nodes with embeddings
    if (trace.concepts && trace.concepts.length > 0) {
      try {
        const conceptEmbeddings = await this.embeddingProvider.embedBatch(trace.concepts);
        for (let i = 0; i < trace.concepts.length; i++) {
          await this.store.ensureConcept(trace.concepts[i], undefined, conceptEmbeddings[i]);
        }
      } catch (err) {
        this.logger.debug("Failed to embed concepts: %s", (err as Error).message);
      }
    }

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
