import { config as loadDotenv } from "dotenv";
import { initChatModel } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { InteropZodObject } from "@langchain/core/utils/types";
import type {
  ContextGraphConfig,
  ResolvedContextGraphConfig,
} from "./types/config.js";
import { GraphmindStore } from "./db/client.js";
import { MultiTenantGraphmindStore } from "./db/multi-tenant-store.js";
import { ContextualRegistry } from "./core/contextual-registry.js";
import { KnowledgeLifecycleManager } from "./core/knowledge-lifecycle.js";
import { createReasoningExtractor } from "./core/reasoning-extractor.js";
import { createPromptInjector } from "./core/prompt-injector.js";
import {
  createSchemaInspectorTool,
  createGraphQueryTool,
} from "./core/schema-inspector.js";
import {
  createEntityTool,
  createRelationshipTool,
  createFindEntitiesTool,
} from "./core/entity-builder.js";

export interface ContextGraphInstance {
  /** Middleware array to pass to createAgent(). */
  middleware: unknown[];
  /** Tools for agents to interact with the context graph (schema inspection, entity creation, etc.). */
  tools: unknown[];
  /** The contextual registry for manual trace recording and retrieval. */
  registry: ContextualRegistry;
  /** The knowledge lifecycle manager for validation, synthesis, and pruning. */
  lifecycle: KnowledgeLifecycleManager;
  /** Direct access to the Graphmind store. */
  store: GraphmindStore;
  /** Multi-tenant store manager for runtime tenant switching. */
  multiTenantStore: MultiTenantGraphmindStore;
  /** Optional runtime context schema exposed for agent creation. */
  contextSchema?: InteropZodObject;
}

/**
 * Resolve config by merging explicit values with environment variables.
 * Loads .env automatically (won't override existing env vars).
 */
function resolveConfig(config: ContextGraphConfig): ResolvedContextGraphConfig {
  // Load .env file (no-op if missing, won't override existing env vars)
  loadDotenv();

  const url =
    config.graphmind?.url ??
    process.env.GRAPHMIND_URL ??
    "http://localhost:8080";

  const token =
    config.graphmind?.token ?? process.env.GRAPHMIND_TOKEN ?? undefined;

  const username =
    config.graphmind?.username ?? process.env.GRAPHMIND_USERNAME ?? undefined;

  const password =
    config.graphmind?.password ?? process.env.GRAPHMIND_PASSWORD ?? undefined;

  return {
    ...config,
    graphmind: { url, token, username, password },
  };
}

/**
 * Create a Context Graph instance — the main entry point for the middleware.
 *
 * Returns middleware (for LangChain agent), tools (for agent brain-mapping),
 * and lifecycle manager (for knowledge curation).
 *
 * ```typescript
 * const cg = await createContextGraph({
 *   tenant: "my_company",
 *   project: "support",
 *   agent: "support-agent",
 *   embedding: { provider: myEmbeddingProvider, dimensions: 1536 },
 * });
 *
 * const agent = createAgent({
 *   model: "claude-sonnet-4-6",
 *   tools: [...myTools, ...cg.tools],
 *   middleware: cg.middleware,
 * });
 * ```
 */
export async function createContextGraph(
  config: ContextGraphConfig,
): Promise<ContextGraphInstance> {
  const resolved = resolveConfig(config);

  // Initialize multi-tenant store manager
  const multiTenantStore = new MultiTenantGraphmindStore(
    resolved,
    resolved.embedding.provider,
  );

  // Get or create base store for initial tenant
  const store = await multiTenantStore.getStoreForRuntime();

  // Initialize observer model for ablation filtering and structured extraction
  let observerModel: BaseChatModel | null = null;
  if (resolved.observerModel) {
    observerModel = await initChatModel(resolved.observerModel);
  }

  // Create core components with multi-tenant store
  const registry = new ContextualRegistry(
    multiTenantStore,
    resolved.embedding.provider,
    resolved,
  );
  const lifecycle = new KnowledgeLifecycleManager(store, resolved);

  // Create middleware
  const promptInjector = createPromptInjector(
    registry,
    resolved,
    resolved.contextSchema,
  );
  const reasoningExtractor = createReasoningExtractor(
    resolved,
    registry,
    observerModel,
    resolved.contextSchema,
  );

  // Create agent tools for brain-mapping
  const tools = [
    createSchemaInspectorTool(store),
    createGraphQueryTool(store),
    createEntityTool(store),
    createRelationshipTool(store),
    createFindEntitiesTool(store),
  ];

  return {
    middleware: [promptInjector, reasoningExtractor],
    tools,
    registry,
    lifecycle,
    store,
    multiTenantStore,
    contextSchema: resolved.contextSchema,
  };
}

// Re-export all public types and classes
export type {
  ContextGraphConfig,
  ResolvedContextGraphConfig,
  GraphmindConnectionConfig,
  EmbeddingConfig,
} from "./types/config.js";
export {
  DEFAULT_VECTOR_SEARCH_LIMIT,
  DEFAULT_SIMILARITY_THRESHOLD,
  DEFAULT_METRIC,
} from "./types/config.js";
export type {
  Intent,
  Constraint,
  Action,
  Justification,
  ToolCall,
  Agent,
  Domain,
  Project,
  Concept,
  Skill,
  ContextSharingPolicy,
  DecisionTrace,
  TraceStatus,
  ScoredDecisionTrace,
  FormattedContext,
  GraphEntity,
  GraphRelationship,
  SchemaOverview,
} from "./types/data-model.js";
export type {
  UniversalLogicClass,
  LogicClassMapping,
} from "./types/logic-classes.js";
export type {
  ValidationResult,
  LifecycleStats,
  SynthesizeOptions,
  PruneOptions,
} from "./types/lifecycle.js";
export type { EmbeddingProvider } from "./embeddings/provider.js";
export {
  LangChainEmbeddingAdapter,
  type LangChainEmbeddings,
  KNOWN_EMBEDDING_DIMENSIONS,
  getKnownEmbeddingDimensions,
} from "./embeddings/langchain-adapter.js";
export type { AblationResult } from "./core/ablation-filter.js";

// Re-export classes for advanced usage
export { GraphmindStore } from "./db/client.js";
export { MultiTenantGraphmindStore } from "./db/multi-tenant-store.js";
export type { RuntimeTenantContext } from "./db/multi-tenant-store.js";
export { ContextualRegistry } from "./core/contextual-registry.js";
export { KnowledgeLifecycleManager } from "./core/knowledge-lifecycle.js";
export { createReasoningExtractor } from "./core/reasoning-extractor.js";
export { createPromptInjector } from "./core/prompt-injector.js";
export { ablationFilter, filterCriticalFacts } from "./core/ablation-filter.js";
export { DEFAULT_LOGIC_MAPPINGS } from "./types/logic-classes.js";
export {
  createSkillTool,
  createListSkillsTool,
  formatSkillAsMarkdown,
} from "./core/skill-tool.js";
export {
  createSchemaInspectorTool,
  createGraphQueryTool,
  formatSchemaForPrompt,
} from "./core/schema-inspector.js";
export {
  createEntityTool,
  createRelationshipTool,
  createFindEntitiesTool,
} from "./core/entity-builder.js";
