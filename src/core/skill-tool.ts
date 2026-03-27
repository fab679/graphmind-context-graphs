import { tool } from "langchain";
import { z } from "zod";
import type { GraphmindStore } from "../db/client.js";

/**
 * Creates a `load_skill` tool that agents can use for progressive disclosure.
 *
 * Instead of injecting all skill context upfront, this tool lets the agent
 * discover and load skills on-demand — keeping the context window lean.
 *
 * Usage with createAgent():
 * ```typescript
 * const skillTool = createSkillTool(contextGraph.store);
 * const agent = createAgent({
 *   model: "openai:gpt-4.1",
 *   tools: [...yourTools, skillTool],
 *   middleware: contextGraph.middleware,
 * });
 * ```
 */
export function createSkillTool(store: GraphmindStore) {
  return tool(
    async ({ skill_name }) => {
      const skill = await store.getSkillByName(skill_name);

      if (!skill) {
        // List available skills as a fallback
        const available = await store.getSkillsByProject();
        if (available.length === 0) {
          return "No skills available yet. Skills are automatically created as the knowledge lifecycle promotes and clusters decision traces.";
        }
        const manifest = available
          .map((s) => `- ${s.name}: ${s.description} (confidence: ${s.confidence.toFixed(2)})`)
          .join("\n");
        return `Skill "${skill_name}" not found. Available skills:\n${manifest}`;
      }

      const parts: string[] = [skill.prompt];

      if (skill.tools.length > 0) {
        parts.push(`\nRecommended tools: ${skill.tools.join(", ")}`);
      }

      if (skill.domain) {
        parts.push(`Domain: ${skill.domain}`);
      }

      parts.push(`\nConfidence: ${skill.confidence.toFixed(2)} (based on ${skill.traceCount} validated traces)`);

      return parts.join("\n");
    },
    {
      name: "load_skill",
      description:
        "Load a specialized skill by name to get expert guidance for a specific scenario. " +
        "Use this when the available skills listed in the system prompt match the current task. " +
        "The skill provides validated decision patterns and recommended approaches.",
      schema: z.object({
        skill_name: z
          .string()
          .describe(
            "The name of the skill to load (e.g., 'handle-account-lockout', 'handle-rate-limiting')"
          ),
      }),
    }
  );
}

/**
 * Creates a `list_skills` tool for discovering available skills.
 * Useful when the agent needs to explore what skills are available.
 */
export function createListSkillsTool(store: GraphmindStore) {
  return tool(
    async () => {
      const skills = await store.getSkillsByProject();
      if (skills.length === 0) {
        return "No skills available yet. Skills are automatically created as decision traces are validated and synthesized.";
      }

      const manifest = skills.map((s) => {
        const tags = s.concepts.length > 0
          ? ` [${s.concepts.map((c) => `#${c}`).join(", ")}]`
          : "";
        const domain = s.domain ? ` (${s.domain})` : "";
        return `- **${s.name}**${domain}: ${s.description} — confidence: ${s.confidence.toFixed(2)}, ${s.traceCount} traces${tags}`;
      });

      return `Available skills:\n${manifest.join("\n")}\n\nUse load_skill to access the full skill context.`;
    },
    {
      name: "list_skills",
      description:
        "List all available skills that can be loaded for specialized guidance. " +
        "Skills are curated bundles of validated decision patterns.",
      schema: z.object({}),
    }
  );
}
