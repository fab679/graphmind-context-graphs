import { createMiddleware } from "langchain";
import type { InteropZodObject } from "@langchain/core/utils/types";
import type { ContextGraphConfig } from "../types/config.js";
import type { ContextualRegistry } from "./contextual-registry.js";
import type { RuntimeTenantContext } from "../db/multi-tenant-store.js";
import type { EmbeddingProvider } from "../embeddings/provider.js";
import type {
  DecisionTrace,
  Skill,
  ScoredDecisionTrace,
  SchemaOverview,
} from "../types/data-model.js";
import { createLogger } from "../utils/logger.js";
import { formatSchemaForPrompt } from "./schema-inspector.js";

export function createPromptInjector(
  registry: ContextualRegistry,
  config: ContextGraphConfig,
  contextSchema?: InteropZodObject,
) {
  const logger = createLogger(config.debug);

  return createMiddleware({
    name: "ContextGraphPromptInjector",
    contextSchema,
    wrapModelCall: async (request, handler) => {
      const messages = request.messages ?? [];
      const lastUserMessage = [...messages]
        .reverse()
        .find(
          (m: any) =>
            (m._getType?.() ?? m.role) === "human" ||
            (m._getType?.() ?? m.role) === "user",
        );

      if (!lastUserMessage) {
        return handler(request);
      }

      const userContent =
        typeof lastUserMessage.content === "string"
          ? lastUserMessage.content
          : "";

      if (!userContent) {
        return handler(request);
      }

      try {
        const runtime = request.runtime?.context as
          | Record<string, unknown>
          | undefined;
        const runtimeEmbedding =
          typeof runtime?.embedding === "object" &&
          runtime.embedding !== null &&
          "provider" in runtime.embedding
            ? (runtime.embedding as { provider: EmbeddingProvider }).provider
            : undefined;
        const runtimeTenantContext: RuntimeTenantContext | undefined =
          runtime
            ? {
                tenant:
                  typeof runtime.tenant === "string"
                    ? runtime.tenant
                    : undefined,
                project:
                  typeof runtime.project === "string"
                    ? runtime.project
                    : undefined,
                agent:
                  typeof runtime.agent === "string"
                    ? runtime.agent
                    : undefined,
                agentDescription:
                  typeof runtime.agentDescription === "string"
                    ? runtime.agentDescription
                    : undefined,
                embedding:
                  typeof runtime.embedding === "object" &&
                  runtime.embedding !== null &&
                  "provider" in runtime.embedding
                    ? (runtime.embedding as {
                        provider: EmbeddingProvider;
                        dimensions: number;
                      })
                    : undefined,
              }
            : undefined;

        const context = await registry.getRelevantContext(
          userContent,
          runtimeEmbedding,
          runtimeTenantContext,
        );

        const sections: string[] = [];

        const effectiveBasePrompt =
          typeof runtime?.baseSystemPrompt === "string"
            ? runtime.baseSystemPrompt
            : config.baseSystemPrompt;

        if (effectiveBasePrompt) {
          sections.push(effectiveBasePrompt);
        }

        const runtimeMetadata: string[] = [];
        if (runtime) {
          if (typeof runtime.tenant === "string") {
            runtimeMetadata.push(`Tenant: ${runtime.tenant}`);
          }
          if (typeof runtime.project === "string") {
            runtimeMetadata.push(`Project: ${runtime.project}`);
          }
          if (typeof runtime.agent === "string") {
            runtimeMetadata.push(`Agent: ${runtime.agent}`);
          }
          if (typeof runtime.agentDescription === "string") {
            runtimeMetadata.push(
              `Agent description: ${runtime.agentDescription}`,
            );
          }
          if (typeof runtime.observerModel === "string") {
            runtimeMetadata.push(`Observer model: ${runtime.observerModel}`);
          }
          if (typeof runtime.debug === "boolean") {
            runtimeMetadata.push(`Debug mode: ${runtime.debug}`);
          }
          if (typeof runtime.note === "string") {
            runtimeMetadata.push(`Note: ${runtime.note}`);
          }
        }

        if (runtimeMetadata.length > 0) {
          sections.push(`## Runtime Context\n${runtimeMetadata.join("\n")}`);
        }

        // Schema awareness — show agents what entities exist in their brain
        if (context.schema && context.schema.nodeLabels.length > 0) {
          const schemaSection = formatSchemaForPrompt(context.schema);
          if (schemaSection) {
            sections.push(schemaSection);
            logger.info(
              "Injecting schema overview (%d entity types, %d relationship types)",
              context.schema.nodeLabels.length,
              context.schema.relationshipTypes.length,
            );
          }
        }

        if (context.pastTraces.length > 0) {
          sections.push(formatPastLogic(context.pastTraces));
          logger.info(
            "Injecting %d past trace(s) into system prompt",
            context.pastTraces.length,
          );
        }

        if (context.rules.length > 0) {
          sections.push(formatRules(context.rules));
          logger.info(
            "Injecting %d rule(s) into system prompt",
            context.rules.length,
          );
        }

        if (context.antiPatterns.length > 0) {
          sections.push(formatAntiPatterns(context.antiPatterns));
          logger.info(
            "Injecting %d anti-pattern(s) into system prompt",
            context.antiPatterns.length,
          );
        }

        if (context.skills.length > 0) {
          sections.push(formatSkillManifest(context.skills));
          logger.info(
            "Injecting %d skill(s) into system prompt",
            context.skills.length,
          );
        }

        if (
          context.pastTraces.length === 0 &&
          context.rules.length === 0 &&
          context.skills.length === 0
        ) {
          logger.debug(
            "No relevant context found for: %s",
            userContent.slice(0, 80),
          );
        }

        const systemPrompt = sections.join("\n\n");
        return handler({
          ...request,
          systemMessage: request.systemMessage.concat(systemPrompt),
        });
      } catch (err) {
        logger.warn("Failed to inject context: %s", (err as Error).message);
        return handler(request);
      }
    },
  });
}

function formatPastLogic(traces: ScoredDecisionTrace[]): string {
  const items = traces.map(({ trace, similarity }) => {
    const intentShort = truncateForPrompt(trace.intent.description, 120);
    const actionShort = truncateForPrompt(trace.action.description, 150);
    const whyShort = truncateForPrompt(trace.justification.description, 150);
    const domainTag = trace.domain ? ` [${trace.domain}]` : "";
    const conceptTags =
      trace.concepts && trace.concepts.length > 0
        ? ` tags: ${trace.concepts.map((c) => `#${c}`).join(", ")}`
        : "";
    const constraintLines = trace.constraints
      .slice(0, 3) // Max 3 constraints per trace
      .map((c) => `  - [${c.type}] ${truncateForPrompt(c.description, 100)}`);
    const constraintSection =
      constraintLines.length > 0
        ? `\n  **Constraints**:\n${constraintLines.join("\n")}`
        : "";
    return `- **Intent**: ${intentShort} (similarity: ${similarity.toFixed(2)})${domainTag}${conceptTags}
  **Action**: ${actionShort}
  **Why**: ${whyShort}${constraintSection}`;
  });

  return `## Relevant Past Logic (Director's Commentary)
The following past decisions are relevant to the current task.

${items.join("\n\n")}`;
}

function truncateForPrompt(text: string, maxLen: number): string {
  if (!text) return "";
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= maxLen ? clean : clean.substring(0, maxLen - 1) + "…";
}

function formatRules(rules: DecisionTrace[]): string {
  const items = rules.map((r) => {
    const conceptTags =
      r.concepts && r.concepts.length > 0
        ? ` [${r.concepts.map((c) => `#${c}`).join(", ")}]`
        : "";
    return `- ${r.justification.description} (confidence: ${r.justification.confidence.toFixed(2)})${conceptTags}`;
  });

  return `## Established Rules
These patterns have been validated multiple times and should be followed:

${items.join("\n")}`;
}

function formatAntiPatterns(antiPatterns: DecisionTrace[]): string {
  const items = antiPatterns.map(
    (r) => `- AVOID: ${r.justification.description} (reason: led to failure)`,
  );

  return `## Anti-Patterns to Avoid
These approaches have been tried and consistently failed:

${items.join("\n")}`;
}

function formatSkillManifest(skills: Skill[]): string {
  const items = skills.map((s) => {
    const domain = s.domain ? ` [${s.domain}]` : "";
    const tools = s.tools.length > 0 ? ` (tools: ${s.tools.join(", ")})` : "";
    return `- **${s.name}**${domain}: ${s.description}${tools}`;
  });

  return `## Skills System
You have access to specialized skills derived from validated decision patterns.
When a user's request matches a skill below, use \`load_skill\` with the skill name to load its full instructions before proceeding.

${items.join("\n")}`;
}
