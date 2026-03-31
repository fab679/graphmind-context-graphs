import { describe, it, expect } from "vitest";
import { z } from "zod";
import { createPromptInjector } from "../../src/core/prompt-injector.js";
import { createReasoningExtractor } from "../../src/core/reasoning-extractor.js";
import type { ContextGraphConfig } from "../../src/types/config.js";
import type { ContextualRegistry } from "../../src/core/contextual-registry.js";

const dummyConfig: ContextGraphConfig = {
  tenant: "test-tenant",
  project: "test-project",
  embedding: {
    provider: {
      embed: async (_text: string) => [0.1],
      embedBatch: async (_texts: string[]) => [[0.1]],
      dimensions: 1,
    },
    dimensions: 1,
  },
};

const dummyRegistry = {} as ContextualRegistry;

describe("Graphmind runtime context support", () => {
  it("should attach contextSchema to Graphmind middleware", () => {
    const contextSchema = z.object({ requestId: z.string() });

    const injector = createPromptInjector(
      dummyRegistry,
      dummyConfig,
      contextSchema,
    );
    const extractor = createReasoningExtractor(
      dummyConfig,
      dummyRegistry,
      null,
      contextSchema,
    );

    expect((injector as any).contextSchema).toBe(contextSchema);
    expect((extractor as any).contextSchema).toBe(contextSchema);
  });
});
