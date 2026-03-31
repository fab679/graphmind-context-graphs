import type { ResolvedContextGraphConfig } from "../types/config.js";
import { DEFAULT_METRIC } from "../types/config.js";
import type { DecisionTrace, ScoredDecisionTrace } from "../types/data-model.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import { GraphmindStore } from "./client.js";
import { buildGraphNamespace } from "../utils/namespace.js";
import { bootstrapSchema } from "./schema.js";
import { createLogger, type Logger } from "../utils/logger.js";

/**
 * Runtime tenant context passed via middleware.
 */
export interface RuntimeTenantContext {
  tenant?: string;
  project?: string;
  agent?: string;
  agentDescription?: string;
  embedding?: {
    provider: EmbeddingProvider;
    dimensions: number;
  };
}

/**
 * Multi-tenant store manager that lazily creates tenant-specific stores.
 * This enables runtime context to specify different tenants, and the system
 * will automatically create/initialize the appropriate context graph.
 */
export class MultiTenantGraphmindStore {
  private config: ResolvedContextGraphConfig;
  private stores: Map<string, GraphmindStore> = new Map();
  private embeddingProvider: EmbeddingProvider;
  private logger: Logger;

  constructor(
    config: ResolvedContextGraphConfig,
    embeddingProvider: EmbeddingProvider
  ) {
    this.config = config;
    this.embeddingProvider = embeddingProvider;
    this.logger = createLogger(config.debug);
  }

  /**
   * Get or create a store for the specified runtime context.
   * If runtime tenant differs from base config, creates a new store dynamically.
   */
  async getStoreForRuntime(
    runtimeContext?: RuntimeTenantContext
  ): Promise<GraphmindStore> {
    const effectiveTenant = runtimeContext?.tenant ?? this.config.tenant;
    const effectiveProject = runtimeContext?.project ?? this.config.project;
    const effectiveAgent = runtimeContext?.agent ?? this.config.agent;
    const effectiveAgentDescription =
      runtimeContext?.agentDescription ?? this.config.agentDescription;

    // Use base store if tenant matches the original config
    if (
      !runtimeContext?.tenant ||
      runtimeContext.tenant === this.config.tenant
    ) {
      if (!this.stores.has(this.config.tenant)) {
        const store = new GraphmindStore(this.config);
        await store.initialize();
        this.stores.set(this.config.tenant, store);
        this.logger.info(
          "Initialized base store for tenant: %s",
          this.config.tenant
        );
      }
      return this.stores.get(this.config.tenant)!;
    }

    // Check if we already have a store for this runtime tenant
    const storeKey = `${effectiveTenant}:${effectiveProject}:${effectiveAgent ?? "default"}`;
    if (this.stores.has(storeKey)) {
      return this.stores.get(storeKey)!;
    }

    // Create new store configuration for runtime tenant
    const runtimeConfig: ResolvedContextGraphConfig = {
      ...this.config,
      tenant: effectiveTenant,
      project: effectiveProject,
      agent: effectiveAgent,
      agentDescription: effectiveAgentDescription,
      // Use runtime embedding provider if provided, otherwise use base
      embedding: runtimeContext?.embedding ?? this.config.embedding,
    };

    // Create and initialize the new store
    this.logger.info(
      "Creating new context graph for runtime tenant: %s, project: %s, agent: %s",
      effectiveTenant,
      effectiveProject,
      effectiveAgent ?? "default"
    );

    const store = new GraphmindStore(runtimeConfig);
    await store.initialize();
    this.stores.set(storeKey, store);

    this.logger.info(
      "Successfully initialized context graph: %s",
      buildGraphNamespace(effectiveTenant)
    );

    return store;
  }

  /**
   * Get the base store (original tenant from config).
   */
  getBaseStore(): GraphmindStore {
    return this.stores.get(this.config.tenant)!;
  }

  /**
   * Get all active stores.
   */
  getAllStores(): GraphmindStore[] {
    return Array.from(this.stores.values());
  }

  /**
   * Clear all cached stores (useful for testing or reset).
   */
  clear(): void {
    this.stores.clear();
  }
}
