import { config as loadDotenv } from "dotenv";
import { initChatModel } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ContextGraphConfig, ResolvedContextGraphConfig } from "./types/config.js";
import { GraphmindStore } from "./db/client.js";
import { ContextualRegistry } from "./core/contextual-registry.js";
import { KnowledgeLifecycleManager } from "./core/knowledge-lifecycle.js";
import { createReasoningExtractor } from "./core/reasoning-extractor.js";
import { createPromptInjector } from "./core/prompt-injector.js";

export interface ContextGraphInstance {
  middleware: unknown[];
  registry: ContextualRegistry;
  lifecycle: KnowledgeLifecycleManager;
  store: GraphmindStore;
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
    config.graphmind?.token ??
    process.env.GRAPHMIND_TOKEN ??
    undefined;

  const username =
    config.graphmind?.username ??
    process.env.GRAPHMIND_USERNAME ??
    undefined;

  const password =
    config.graphmind?.password ??
    process.env.GRAPHMIND_PASSWORD ??
    undefined;

  return {
    ...config,
    graphmind: { url, token, username, password },
  };
}

export async function createContextGraph(
  config: ContextGraphConfig
): Promise<ContextGraphInstance> {
  const resolved = resolveConfig(config);

  // Initialize database store and bootstrap schema
  const store = new GraphmindStore(resolved);
  await store.initialize();

  // Initialize observer model for ablation filtering
  let observerModel: BaseChatModel | null = null;
  if (resolved.observerModel) {
    observerModel = await initChatModel(resolved.observerModel);
  }

  // Create core components
  const registry = new ContextualRegistry(
    store,
    resolved.embedding.provider,
    resolved
  );
  const lifecycle = new KnowledgeLifecycleManager(store, resolved);

  // Create middleware
  const promptInjector = createPromptInjector(registry, resolved);
  const reasoningExtractor = createReasoningExtractor(
    resolved,
    registry,
    observerModel
  );

  return {
    middleware: [promptInjector, reasoningExtractor],
    registry,
    lifecycle,
    store,
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
export type { AblationResult } from "./core/ablation-filter.js";

// Re-export classes for advanced usage
export { GraphmindStore } from "./db/client.js";
export { ContextualRegistry } from "./core/contextual-registry.js";
export { KnowledgeLifecycleManager } from "./core/knowledge-lifecycle.js";
export { createReasoningExtractor } from "./core/reasoning-extractor.js";
export { createPromptInjector } from "./core/prompt-injector.js";
export { ablationFilter, filterCriticalFacts } from "./core/ablation-filter.js";
export { DEFAULT_LOGIC_MAPPINGS } from "./types/logic-classes.js";
export { createSkillTool, createListSkillsTool } from "./core/skill-tool.js";
