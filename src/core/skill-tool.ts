import { tool } from "langchain";
import { z } from "zod";
import type { GraphmindStore } from "../db/client.js";
import type { Skill } from "../types/data-model.js";

/**
 * Format a Skill as a SKILL.md-compatible document following the Agent Skills specification.
 * This ensures skills work identically whether loaded from the graph or from a filesystem.
 *
 * @see https://agentskills.io/specification
 */
export function formatSkillAsMarkdown(skill: Skill): string {
  const frontmatter = [
    "---",
    `name: ${skill.name}`,
    `description: ${skill.description}`,
  ];
  if (skill.tools.length > 0) {
    frontmatter.push(`allowed-tools: ${skill.tools.join(", ")}`);
  }
  if (skill.domain) {
    frontmatter.push(`metadata:`);
    frontmatter.push(`  domain: ${skill.domain}`);
    frontmatter.push(`  confidence: "${skill.confidence.toFixed(2)}"`);
    frontmatter.push(`  trace-count: "${skill.traceCount}"`);
  }
  frontmatter.push("---");

  const body = [
    `# ${skill.name}`,
    "",
    "## Overview",
    "",
    skill.description,
    "",
    "## Instructions",
    "",
    skill.prompt,
  ];

  if (skill.concepts.length > 0) {
    body.push("", `## Tags`, "", skill.concepts.map((c) => `- #${c}`).join("\n"));
  }

  return [...frontmatter, "", ...body].join("\n");
}

/**
 * Creates a `load_skill` tool that agents can use for progressive disclosure.
 *
 * Returns skill content in SKILL.md format (Agent Skills specification),
 * making graph-synthesized skills compatible with the DeepAgents ecosystem.
 *
 * Usage with createAgent():
 * ```typescript
 * const skillTool = createSkillTool(contextGraph.store);
 * const agent = createAgent({
 *   model: "claude-sonnet-4-6",
 *   tools: [...yourTools, skillTool],
 *   middleware: contextGraph.middleware,
 * });
 * ```
 */
export function createSkillTool(store: GraphmindStore) {
  return tool(
    async ({ skill_name }) => {
      // If it's a URL, fetch the remote SKILL.md
      if (skill_name.startsWith("http://") || skill_name.startsWith("https://")) {
        try {
          const response = await fetch(skill_name);
          if (!response.ok) {
            return `Failed to fetch skill from URL: ${response.status} ${response.statusText}`;
          }
          return await response.text();
        } catch (err) {
          return `Failed to fetch skill from URL: ${(err as Error).message}`;
        }
      }

      // Otherwise load from graph
      const skill = await store.getSkillByName(skill_name);

      if (!skill) {
        const available = await store.getSkillsByProject();
        if (available.length === 0) {
          return "No skills available yet. Skills are automatically created as the knowledge lifecycle promotes and clusters decision traces.";
        }
        const manifest = available
          .map((s) => `- ${s.name}: ${s.description} (confidence: ${s.confidence.toFixed(2)})`)
          .join("\n");
        return `Skill "${skill_name}" not found. Available skills:\n${manifest}`;
      }

      return formatSkillAsMarkdown(skill);
    },
    {
      name: "load_skill",
      description:
        "Load a specialized skill by name or URL. " +
        "Pass a skill name to load from the context graph, or a URL to fetch a remote SKILL.md file. " +
        "Use this when the available skills listed in the system prompt match the current task.",
      schema: z.object({
        skill_name: z
          .string()
          .describe(
            "Skill name (e.g., 'handle-account-lockout') or URL to a SKILL.md file"
          ),
      }),
    }
  );
}

/**
 * Creates a `list_skills` tool for discovering available skills.
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

/**
 * Export all graph-synthesized skills to a directory as SKILL.md files,
 * compatible with DeepAgents filesystem skills.
 *
 * This bridges graph-based skills with the Agent Skills specification,
 * letting users use synthesized skills with any Agent Skills-compatible framework.
 *
 * ```typescript
 * import { writeFile, mkdir } from "fs/promises";
 *
 * const skills = await contextGraph.store.getSkillsByProject();
 * for (const skill of skills) {
 *   const full = await contextGraph.store.getSkillByName(skill.name);
 *   if (!full) continue;
 *   const dir = `./skills/${skill.name}`;
 *   await mkdir(dir, { recursive: true });
 *   await writeFile(`${dir}/SKILL.md`, formatSkillAsMarkdown(full));
 * }
 * ```
 */
// The formatSkillAsMarkdown function above handles the export format.
// Users call it directly as shown in the example.
