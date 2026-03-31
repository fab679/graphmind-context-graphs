/**
 * LangChain Embeddings Adapter — Auto-detect dimensions from any LangChain embedding model.
 *
 * Wraps any LangChain Embeddings class (OpenAI, Azure, Cohere, Ollama, etc.)
 * and automatically detects embedding dimensions by making a test embedding call.
 *
 * Supports all LangChain embedding providers:
 * - OpenAI (@langchain/openai)
 * - Azure OpenAI (@langchain/openai)
 * - AWS Bedrock (@langchain/aws)
 * - Google Gemini (@langchain/google-genai)
 * - Google Vertex AI (@langchain/google-vertexai)
 * - MistralAI (@langchain/mistralai)
 * - Cohere (@langchain/cohere)
 * - Ollama (@langchain/ollama)
 * - And all other LangChain-compatible embeddings
 */

import type { EmbeddingProvider } from "./provider.js";

/**
 * Interface matching LangChain's Embeddings class.
 * Any LangChain-compatible embeddings implementation can be wrapped.
 */
export interface LangChainEmbeddings {
  embedQuery(document: string): Promise<number[]>;
  embedDocuments(documents: string[]): Promise<number[][]>;
}

/**
 * Adapter that wraps any LangChain Embeddings and provides auto-detected dimensions.
 *
 * Automatically detects embedding dimensions by making a test embedding call
 * on first use. This works with any LangChain-compatible embedding model.
 *
 * @example
 * ```typescript
 * import { OpenAIEmbeddings } from "@langchain/openai";
 * import { LangChainEmbeddingAdapter } from "graphmind-context-graphs";
 *
 * const langchainEmbeddings = new OpenAIEmbeddings({
 *   model: "text-embedding-3-large"
 * });
 *
 * const provider = new LangChainEmbeddingAdapter(langchainEmbeddings);
 *
 * // Dimensions auto-detected on first embed() call
 * const cg = await createContextGraph({
 *   tenant: "my_tenant",
 *   project: "my_project",
 *   embedding: { provider, dimensions: provider.dimensions },
 * });
 * ```
 */
export class LangChainEmbeddingAdapter implements EmbeddingProvider {
  private _embeddings: LangChainEmbeddings;
  private _dimensions: number | null = null;

  constructor(embeddings: LangChainEmbeddings) {
    this._embeddings = embeddings;
  }

  /**
   * Get embedding dimensions. Auto-detects on first call by making a test embedding.
   */
  get dimensions(): number {
    if (this._dimensions === null) {
      throw new Error(
        "Dimensions not yet detected. Call embed() or embedBatch() first, " +
        "or use await provider.detectDimensions() to pre-detect."
      );
    }
    return this._dimensions;
  }

  /**
   * Explicitly detect dimensions by making a test embedding call.
   * Call this before creating the ContextGraph if you need dimensions upfront.
   */
  async detectDimensions(): Promise<number> {
    if (this._dimensions !== null) {
      return this._dimensions;
    }

    const testEmbedding = await this._embeddings.embedQuery("test");
    this._dimensions = testEmbedding.length;
    return this._dimensions;
  }

  /**
   * Embed a single text string.
   * Auto-detects dimensions on first call.
   */
  async embed(text: string): Promise<number[]> {
    const result = await this._embeddings.embedQuery(text);

    // Auto-detect dimensions on first successful embedding
    if (this._dimensions === null) {
      this._dimensions = result.length;
    }

    return result;
  }

  /**
   * Embed multiple texts in batch.
   * Auto-detects dimensions on first call.
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const results = await this._embeddings.embedDocuments(texts);

    // Auto-detect dimensions on first successful embedding
    if (this._dimensions === null && results.length > 0) {
      this._dimensions = results[0].length;
    }

    return results;
  }
}

/**
 * Known embedding dimensions for popular models.
 * Used as fallback when auto-detection isn't possible.
 */
export const KNOWN_EMBEDDING_DIMENSIONS: Record<string, number> = {
  // OpenAI
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,

  // Azure OpenAI (same as OpenAI)
  "text-embedding-ada-002-azure": 1536,

  // AWS Bedrock
  "amazon.titan-embed-text-v1": 1536,
  "amazon.titan-embed-text-v2": 1024,
  "amazon.titan-embed-image-v1": 1024,

  // Google
  "text-embedding-004": 768,
  "gemini-embedding-001": 768,
  "embedding-001": 768,

  // MistralAI
  "mistral-embed": 1024,

  // Cohere
  "embed-english-v3.0": 1024,
  "embed-english-light-v3.0": 384,
  "embed-multilingual-v3.0": 1024,
  "embed-multilingual-light-v3.0": 384,

  // Ollama common models
  "llama2": 4096,
  "llama3": 4096,
  "mistral": 4096,
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
  "all-minilm": 384,
};

/**
 * Get known dimensions for a model name, or null if unknown.
 */
export function getKnownEmbeddingDimensions(modelName: string): number | null {
  return KNOWN_EMBEDDING_DIMENSIONS[modelName] ?? null;
}
