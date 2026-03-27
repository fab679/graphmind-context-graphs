import { dynamicSystemPromptMiddleware } from "langchain";
import type { ContextGraphConfig } from "../types/config.js";
import type { ContextualRegistry } from "./contextual-registry.js";
import type {
  DecisionTrace,
  Skill,
  ScoredDecisionTrace,
} from "../types/data-model.js";
import { createLogger } from "../utils/logger.js";

export function createPromptInjector(
  registry: ContextualRegistry,
  config: ContextGraphConfig
) {
  const logger = createLogger(config.debug);

  return dynamicSystemPromptMiddleware(async (state: any) => {
    const messages = state.messages ?? [];
    const lastUserMessage = [...messages]
      .reverse()
      .find(
        (m: any) =>
          (m._getType?.() ?? m.role) === "human" ||
          (m._getType?.() ?? m.role) === "user"
      );

    if (!lastUserMessage) {
      return config.baseSystemPrompt ?? "";
    }

    const userContent =
      typeof lastUserMessage.content === "string"
        ? lastUserMessage.content
        : "";

    if (!userContent) {
      return config.baseSystemPrompt ?? "";
    }

    try {
      const context = await registry.getRelevantContext(userContent);

      const sections: string[] = [];

      if (config.baseSystemPrompt) {
        sections.push(config.baseSystemPrompt);
      }

      if (context.pastTraces.length > 0) {
        sections.push(formatPastLogic(context.pastTraces));
        logger.info(
          "Injecting %d past trace(s) into system prompt",
          context.pastTraces.length
        );
      }

      if (context.rules.length > 0) {
        sections.push(formatRules(context.rules));
        logger.info("Injecting %d rule(s) into system prompt", context.rules.length);
      }

      if (context.antiPatterns.length > 0) {
        sections.push(formatAntiPatterns(context.antiPatterns));
        logger.info(
          "Injecting %d anti-pattern(s) into system prompt",
          context.antiPatterns.length
        );
      }

      if (context.skills.length > 0) {
        sections.push(formatSkillManifest(context.skills));
        logger.info(
          "Injecting %d skill(s) into system prompt",
          context.skills.length
        );
      }

      if (context.pastTraces.length === 0 && context.rules.length === 0 && context.skills.length === 0) {
        logger.debug("No relevant context found for: %s", userContent.slice(0, 80));
      }

      return sections.join("\n\n");
    } catch (err) {
      logger.warn(
        "Failed to inject context: %s",
        (err as Error).message
      );
      return config.baseSystemPrompt ?? "";
    }
  });
}

function formatPastLogic(traces: ScoredDecisionTrace[]): string {
  const items = traces.map(({ trace, similarity }) => {
    const constraints = trace.constraints
      .map((c) => `  - [${c.type}] ${c.description}`)
      .join("\n");
    const domainTag = trace.domain ? ` [${trace.domain}]` : "";
    const conceptTags =
      trace.concepts && trace.concepts.length > 0
        ? ` tags: ${trace.concepts.map((c) => `#${c}`).join(", ")}`
        : "";
    return `- **Intent**: ${trace.intent.description} (similarity: ${similarity.toFixed(2)})${domainTag}${conceptTags}
  **Action taken**: ${trace.action.description}
  **Why**: ${trace.justification.description}
${constraints ? `  **Constraints**:\n${constraints}` : ""}`;
  });

  return `## Relevant Past Logic (Director's Commentary)
The following past decisions are relevant to the current task. Use them as reference, not as strict rules.

${items.join("\n\n")}`;
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
    (r) => `- AVOID: ${r.justification.description} (reason: led to failure)`
  );

  return `## Anti-Patterns to Avoid
These approaches have been tried and consistently failed:

${items.join("\n")}`;
}

function formatSkillManifest(skills: Skill[]): string {
  const items = skills.map((s) => {
    const domain = s.domain ? ` [${s.domain}]` : "";
    const tags = s.concepts.length > 0
      ? ` (${s.concepts.map((c) => `#${c}`).join(", ")})`
      : "";
    return `- **${s.name}**${domain}: ${s.description}${tags}`;
  });

  return `## Available Skills
The following specialized skills are available. Use the \`load_skill\` tool to load a skill's full context when it matches the current task.

${items.join("\n")}`;
}
