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
import type { MultiTenantGraphmindStore } from "../db/multi-tenant-store.js";
import type { RuntimeTenantContext } from "../db/multi-tenant-store.js";
import { createLogger, type Logger } from "../utils/logger.js";

export class ContextualRegistry {
  private multiTenantStore: MultiTenantGraphmindStore;
  private embeddingProvider: EmbeddingProvider;
  private config: ContextGraphConfig;
  private logger: Logger;
  private discoveryMode: Map<string, boolean> = new Map();

  constructor(
    multiTenantStore: MultiTenantGraphmindStore,
    embeddingProvider: EmbeddingProvider,
    config: ContextGraphConfig,
  ) {
    this.multiTenantStore = multiTenantStore;
    this.embeddingProvider = embeddingProvider;
    this.config = config;
    this.logger = createLogger(config.debug);
  }

  async isDiscoveryMode(
    runtimeContext?: RuntimeTenantContext,
  ): Promise<boolean> {
    const store = await this.multiTenantStore.getStoreForRuntime(runtimeContext);
    const cacheKey = store.getGraphName();
    
    const cached = this.discoveryMode.get(cacheKey);
    if (cached !== undefined) return cached;
    
    const count = await store.countTraces();
    const isDiscovery = count === 0;
    this.discoveryMode.set(cacheKey, isDiscovery);
    
    if (isDiscovery) {
      this.logger.info(
        "Discovery Mode: no prior traces found for tenant %s, project %s",
        store.getTenant(),
        store.getProject(),
      );
    }
    return isDiscovery;
  }

  async getRelevantContext(
    intentDescription: string,
    runtimeEmbeddingProvider?: EmbeddingProvider,
    runtimeContext?: RuntimeTenantContext,
  ): Promise<FormattedContext> {
    const store = await this.multiTenantStore.getStoreForRuntime(runtimeContext);
    const embeddingProvider = this.getEmbeddingProvider(
      runtimeEmbeddingProvider,
    );
    const embedding = await embeddingProvider.embed(intentDescription);
    const limit = this.config.vectorSearchLimit ?? DEFAULT_VECTOR_SEARCH_LIMIT;

    const [pastTraces, rules, antiPatterns, skills, schema] = await Promise.all(
      [
        store.findSimilarTraces(embedding, limit),
        store.getActiveRules(),
        store.getAntiPatterns(),
        store.getSkillsByProject(),
        store.getSchemaOverview(),
      ],
    );

    this.logger.debug(
      "Retrieved context for tenant %s: %d traces, %d rules, %d anti-patterns, %d skills, %d entity types",
      store.getTenant(),
      pastTraces.length,
      rules.length,
      antiPatterns.length,
      skills.length,
      schema.nodeLabels.length,
    );

    return { pastTraces, rules, antiPatterns, skills, schema };
  }

  async recordDecision(
    trace: Omit<DecisionTrace, "id" | "createdAt" | "updatedAt">,
    runtimeEmbeddingProvider?: EmbeddingProvider,
    runtimeContext?: RuntimeTenantContext,
  ): Promise<string> {
    const store = await this.multiTenantStore.getStoreForRuntime(runtimeContext);
    const embeddingProvider = this.getEmbeddingProvider(
      runtimeEmbeddingProvider,
    );
    // Generate trace embedding from combined text
    const traceText = [
      `Intent: ${trace.intent.description}`,
      ...trace.constraints.map(
        (c) => `Constraint (${c.type}): ${c.description}`,
      ),
      `Action: ${trace.action.description}`,
      `Justification: ${trace.justification.description}`,
    ].join("\n");

    const [traceEmbedding, intentEmbedding] =
      await embeddingProvider.embedBatch([traceText, trace.intent.description]);

    // Embed constraints and action
    const constraintTexts = trace.constraints.map((c) => c.description);
    const constraintEmbeddings =
      constraintTexts.length > 0
        ? await embeddingProvider.embedBatch(constraintTexts)
        : [];
    const [actionEmbedding] = await embeddingProvider.embedBatch([
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

    const traceId = await store.saveDecisionTrace(enrichedTrace);

    // Embed concept names and update concept nodes with embeddings
    if (trace.concepts && trace.concepts.length > 0) {
      try {
        const conceptEmbeddings = await embeddingProvider.embedBatch(
          trace.concepts,
        );
        for (let i = 0; i < trace.concepts.length; i++) {
          await store.ensureConcept(
            trace.concepts[i],
            undefined,
            conceptEmbeddings[i],
          );
        }
      } catch (err) {
        this.logger.debug(
          "Failed to embed concepts: %s",
          (err as Error).message,
        );
      }
    }

    // Semantic generalization: link to similar past traces
    await this.linkPrecedents(traceId, traceEmbedding, store);

    // Reset discovery mode cache for this tenant
    this.discoveryMode.delete(store.getGraphName());

    this.logger.debug("Recorded decision trace: %s for tenant: %s", traceId, store.getTenant());
    return traceId;
  }

  private async linkPrecedents(
    newTraceId: string,
    embedding: number[],
    store: Awaited<ReturnType<typeof this.multiTenantStore.getStoreForRuntime>>,
  ): Promise<void> {
    const threshold =
      this.config.similarityThreshold ?? DEFAULT_SIMILARITY_THRESHOLD;
    const similarTraces = await store.findSimilarTraces(embedding, 5);

    for (const { trace, similarity } of similarTraces) {
      if (trace.id && trace.id !== newTraceId && similarity >= threshold) {
        await store.createPrecedentLink(newTraceId, trace.id, similarity);
        this.logger.debug(
          "Linked trace %s -> %s (similarity: %.3f)",
          newTraceId,
          trace.id,
          similarity,
        );
      }
    }
  }

  private getEmbeddingProvider(
    override?: EmbeddingProvider,
  ): EmbeddingProvider {
    return override ?? this.embeddingProvider;
  }

  async findPrecedents(
    traceId: string,
    runtimeContext?: RuntimeTenantContext,
  ): Promise<ScoredDecisionTrace[]> {
    const store = await this.multiTenantStore.getStoreForRuntime(runtimeContext);
    const trace = await store.getTraceById(traceId);
    if (!trace?.embedding) return [];
    return store.findSimilarTraces(trace.embedding);
  }
}
