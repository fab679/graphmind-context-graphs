import type { ContextGraphConfig } from "../types/config.js";
import type { Skill } from "../types/data-model.js";
import type {
  ValidationResult,
  LifecycleStats,
  SynthesizeOptions,
  PruneOptions,
} from "../types/lifecycle.js";
import {
  DEFAULT_MIN_SUCCESS_COUNT,
  DEFAULT_MIN_FAILURE_COUNT,
} from "../types/lifecycle.js";
import type { GraphmindStore } from "../db/client.js";
import { createLogger, type Logger } from "../utils/logger.js";

/** Minimum synthesized traces sharing a concept to auto-create a skill. */
const DEFAULT_MIN_TRACES_FOR_SKILL = 2;

export class KnowledgeLifecycleManager {
  private store: GraphmindStore;
  private logger: Logger;

  constructor(store: GraphmindStore, config: ContextGraphConfig) {
    this.store = store;
    this.logger = createLogger(config.debug);
  }

  async validateTrace(
    traceId: string,
    result: ValidationResult
  ): Promise<void> {
    const trace = await this.store.getTraceById(traceId);
    if (!trace) {
      throw new Error(`Trace not found: ${traceId}`);
    }

    const currentConfidence = trace.justification.confidence;
    const newConfidence = result.success
      ? Math.min(1, currentConfidence + 0.1)
      : Math.max(0, currentConfidence - 0.15);

    // Atomically update both status and confidence
    await this.store.updateTraceStatusAndConfidence(traceId, "validated", newConfidence);

    this.logger.info(
      "Validated trace %s: %s (confidence: %s -> %s)",
      traceId,
      result.success ? "success" : "failure",
      currentConfidence.toFixed(2),
      newConfidence.toFixed(2)
    );
  }

  async synthesizeRules(options?: SynthesizeOptions): Promise<string[]> {
    const minCount = options?.minSuccessCount ?? DEFAULT_MIN_SUCCESS_COUNT;
    const minConfidence = 0.7;

    const candidates = await this.store.getCandidatesForSynthesis(minConfidence);
    const promoted: string[] = [];

    for (const trace of candidates) {
      if (
        trace.id &&
        trace.justification.confidence >= minConfidence
      ) {
        await this.store.updateTraceStatus(trace.id, "synthesized");
        promoted.push(trace.id);
        this.logger.info(
          "Promoted trace %s to rule (confidence: %.2f)",
          trace.id,
          trace.justification.confidence
        );
      }
    }

    this.logger.info("Synthesized %d new rules", promoted.length);
    return promoted;
  }

  async pruneFailures(options?: PruneOptions): Promise<string[]> {
    const maxConfidence = 0.2;

    const candidateIds = await this.store.getCandidatesForPruning(maxConfidence);
    const marked: string[] = [];

    for (const traceId of candidateIds) {
      await this.store.updateTraceStatus(traceId, "anti_pattern");
      marked.push(traceId);
      this.logger.info("Marked trace %s as anti-pattern", traceId);
    }

    this.logger.info("Pruned %d traces as anti-patterns", marked.length);
    return marked;
  }

  /**
   * Auto-synthesize Skills from synthesized traces that cluster around shared concepts.
   *
   * For each concept with >= minTraces synthesized traces, creates a Skill node:
   * - Name derived from the concept (e.g. concept "account-lockout" → skill "handle-account-lockout")
   * - Prompt compiled from the combined rules of constituent traces
   * - Confidence = average confidence of constituent traces
   * - Tools = unique tool names used across constituent traces
   * - Linked to the concept, project, and domain
   *
   * Returns the names of skills created or updated.
   */
  async synthesizeSkills(minTraces = DEFAULT_MIN_TRACES_FOR_SKILL): Promise<string[]> {
    const groups = await this.store.getSynthesizedTracesByConcept();
    const skillNames: string[] = [];
    const now = new Date().toISOString();

    for (const group of groups) {
      if (group.traces.length < minTraces) continue;

      const skillName = `handle-${group.concept}`;

      // Build the skill prompt from constituent trace rules
      const ruleLines = group.traces.map((t, i) => {
        const parts: string[] = [];
        if (t.intent) parts.push(`Intent: ${t.intent}`);
        if (t.action) parts.push(`Action: ${t.action}`);
        if (t.justification) parts.push(`Why: ${t.justification}`);
        return `${i + 1}. ${parts.join(" → ")}`;
      });

      const prompt = [
        `## Skill: ${skillName}`,
        `You have specialized knowledge for handling "${group.concept}" scenarios.`,
        `The following established rules should guide your decisions:\n`,
        ...ruleLines,
      ].join("\n");

      const avgConfidence =
        group.traces.reduce((sum, t) => sum + t.confidence, 0) /
        group.traces.length;

      // Collect unique tools and domains
      const tools = [...new Set(group.traces.flatMap((t) => t.tools))];
      const domains = [...new Set(group.traces.map((t) => t.domain).filter(Boolean))] as string[];
      const domain = domains.length === 1 ? domains[0] : undefined;

      const description = `Handles ${group.concept} scenarios based on ${group.traces.length} validated decision patterns.`;

      const skill: Omit<Skill, "id"> = {
        name: skillName,
        description,
        prompt,
        confidence: avgConfidence,
        concepts: [group.concept],
        tools,
        traceCount: group.traces.length,
        domain,
        createdAt: now,
        updatedAt: now,
      };

      await this.store.saveSkill(skill);

      // Link constituent traces to the skill
      for (const t of group.traces) {
        await this.store.linkTraceToSkill(String(t.traceId), skillName);
      }

      skillNames.push(skillName);
      this.logger.info(
        "Synthesized skill '%s' from %d traces (confidence: %.2f)",
        skillName,
        group.traces.length,
        avgConfidence
      );
    }

    this.logger.info("Synthesized %d skills", skillNames.length);
    return skillNames;
  }

  async getLifecycleStats(): Promise<LifecycleStats> {
    return this.store.getLifecycleStats();
  }
}
