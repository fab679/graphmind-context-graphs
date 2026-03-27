/**
 * Provider-agnostic model and embedding setup for examples.
 *
 * Uses environment variables so you can swap providers without changing code:
 *
 *   MODEL=openai:gpt-4.1-mini          (or anthropic:claude-sonnet-4-6, etc.)
 *   EMBEDDING_PROVIDER=openai           (or anthropic, google, cohere, etc.)
 *   EMBEDDING_MODEL=text-embedding-3-small
 *   EMBEDDING_DIMENSIONS=1536
 *
 * Requires the corresponding @langchain/* provider package installed:
 *   npm install @langchain/openai       # for OpenAI
 *   npm install @langchain/anthropic    # for Anthropic
 *   npm install @langchain/google-genai # for Google
 *   npm install @langchain/cohere       # for Cohere
 */

import { config as loadDotenv } from "dotenv";
import type { EmbeddingProvider } from "../../src/index.js";

/** Default model if MODEL env var is not set. */
export const DEFAULT_MODEL = "openai:gpt-4.1-mini";

/** Get the model string from env or use default. */
export function getModel(): string {
  return process.env.MODEL ?? DEFAULT_MODEL;
}

/** Get the observer model string from env or use default. */
export function getObserverModel(): string {
  return process.env.OBSERVER_MODEL ?? process.env.MODEL ?? DEFAULT_MODEL;
}

/**
 * Create an EmbeddingProvider from env vars.
 *
 * Supports any LangChain-compatible embedding class.
 * The provider package must be installed separately.
 */
export async function createEmbeddingProvider(): Promise<EmbeddingProvider> {
  // Ensure env vars are loaded before reading provider config
  loadDotenv();

  const providerName = (process.env.EMBEDDING_PROVIDER ?? "openai").toLowerCase();
  const modelName = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
  const dimensions = Number(process.env.EMBEDDING_DIMENSIONS ?? 1536);

  let embeddings: { embedQuery: (text: string) => Promise<number[]>; embedDocuments: (texts: string[]) => Promise<number[][]> };

  switch (providerName) {
    case "openai": {
      const { OpenAIEmbeddings } = await import("@langchain/openai");
      embeddings = new OpenAIEmbeddings({ model: modelName });
      break;
    }
    default: {
      // Generic fallback: try to use OpenAI if the provider isn't explicitly handled.
      // Users can extend this switch for their preferred provider.
      console.warn(
        `[provider] Unknown EMBEDDING_PROVIDER="${providerName}", falling back to OpenAI. ` +
        `Add your provider to examples/shared/provider.ts or set EMBEDDING_PROVIDER=openai`
      );
      const { OpenAIEmbeddings } = await import("@langchain/openai");
      embeddings = new OpenAIEmbeddings({ model: modelName });
    }
  }

  return {
    embed: (text: string) => embeddings.embedQuery(text),
    embedBatch: (texts: string[]) => embeddings.embedDocuments(texts),
    dimensions,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

export function divider(title: string) {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  ${title}`);
  console.log(`${"═".repeat(70)}\n`);
}

export function printMessages(messages: any[]) {
  for (const msg of messages) {
    const role = msg._getType?.() ?? msg.role ?? "unknown";
    const content =
      typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
    const toolCalls = msg.tool_calls ?? [];

    if (role === "human" || role === "user") {
      console.log(`\x1b[36m[User]\x1b[0m ${content}`);
    } else if (role === "ai" || role === "assistant") {
      for (const tc of toolCalls) {
        console.log(
          `\x1b[33m[Agent → Tool]\x1b[0m ${tc.name}(${JSON.stringify(tc.args)})`
        );
      }
      if (content) {
        console.log(`\x1b[32m[Agent]\x1b[0m ${content}`);
      }
    } else if (role === "tool") {
      const preview = content.length > 120 ? content.slice(0, 120) + "…" : content;
      console.log(`\x1b[35m[Tool Result]\x1b[0m ${preview}`);
    }
  }
}
