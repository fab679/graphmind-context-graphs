import type { EmbeddingProvider } from "../embeddings/provider.js";
import type { InteropZodObject } from "@langchain/core/utils/types";
import type { ContextSharingPolicy } from "./data-model.js";

export interface GraphmindConnectionConfig {
  /** Graphmind server URL. Falls back to GRAPHMIND_URL env var. */
  url?: string;
  /** Bearer auth token. Falls back to GRAPHMIND_TOKEN env var. */
  token?: string;
  /** Username for basic auth. Falls back to GRAPHMIND_USERNAME env var. */
  username?: string;
  /** Password for basic auth. Falls back to GRAPHMIND_PASSWORD env var. */
  password?: string;
}

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  dimensions: number;
  metric?: "cosine" | "l2" | "dot";
}

export interface ContextGraphConfig {
  /** Graphmind connection. Falls back to GRAPHMIND_URL / GRAPHMIND_TOKEN env vars. */
  graphmind?: GraphmindConnectionConfig;
  tenant: string;
  project: string;
  /** Optional explicit domain. If omitted, domain is auto-inferred from context. */
  domain?: string;
  /**
   * Agent name — identifies this agent in a multi-agent system.
   * Required for context sharing policies other than "shared".
   */
  agent?: string;
  /** Agent description — human-readable role for this agent. */
  agentDescription?: string;
  /**
   * Context sharing policy for multi-agent systems.
   * - "shared": all agents see all traces in the project (default)
   * - "isolated": agents only see their own traces
   * - "selective": agents see traces from agents listed in `allowedAgents`
   */
  contextSharing?: ContextSharingPolicy;
  /** Agent names whose traces this agent can read (only used when contextSharing = "selective"). */
  allowedAgents?: string[];
  embedding: EmbeddingConfig;
  observerModel?: string;
  /** Optional runtime context schema for per-invocation middleware context. */
  contextSchema?: InteropZodObject;
  vectorSearchLimit?: number;
  similarityThreshold?: number;
  baseSystemPrompt?: string;
  debug?: boolean;
}

/** Config with all env-var fallbacks resolved (url guaranteed present). */
export interface ResolvedContextGraphConfig extends ContextGraphConfig {
  graphmind: Required<Pick<GraphmindConnectionConfig, "url">> &
    Omit<GraphmindConnectionConfig, "url">;
}

export const DEFAULT_VECTOR_SEARCH_LIMIT = 5;
export const DEFAULT_SIMILARITY_THRESHOLD = 0.7;
export const DEFAULT_METRIC = "cosine" as const;
