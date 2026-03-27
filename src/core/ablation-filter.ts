import { z } from "zod";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { Logger } from "../utils/logger.js";

export interface AblationResult {
  fact: string;
  wouldChangeDecision: boolean;
  confidence: number;
}

const AblationResponseSchema = z.object({
  evaluations: z.array(
    z.object({
      factIndex: z.number(),
      wouldChangeDecision: z.boolean(),
      confidence: z.number().min(0).max(1),
      reasoning: z.string(),
    })
  ),
});

const ABLATION_SYSTEM_PROMPT = `You are an Ablation Analysis Engine. Your job is to determine which facts were CRITICAL to a decision.

For each fact provided, ask: "If this fact were removed from the agent's context, would the final decision have been DIFFERENT?"

Respond with a JSON object matching this schema:
{
  "evaluations": [
    {
      "factIndex": <number>,
      "wouldChangeDecision": <boolean>,
      "confidence": <number between 0 and 1>,
      "reasoning": "<brief explanation>"
    }
  ]
}

Be rigorous. Most facts are NOT critical. Only mark a fact as wouldChangeDecision=true if removing it would genuinely alter the outcome.`;

export async function ablationFilter(
  facts: string[],
  decision: string,
  observerModel: BaseChatModel,
  logger: Logger
): Promise<AblationResult[]> {
  if (facts.length === 0) {
    return [];
  }

  const factsFormatted = facts
    .map((fact, i) => `[${i}] ${fact}`)
    .join("\n");

  const prompt = `## Decision Made
${decision}

## Facts Used During Reasoning
${factsFormatted}

For each fact, determine if removing it would change the decision. Respond with valid JSON only.`;

  try {
    const response = await observerModel.invoke([
      new SystemMessage(ABLATION_SYSTEM_PROMPT),
      new HumanMessage(prompt),
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn("Ablation filter: no JSON found in response");
      return facts.map((fact) => ({
        fact,
        wouldChangeDecision: true,
        confidence: 0.5,
      }));
    }

    const parsed = AblationResponseSchema.parse(JSON.parse(jsonMatch[0]));

    return facts.map((fact, i) => {
      const evaluation = parsed.evaluations.find((e) => e.factIndex === i);
      return {
        fact,
        wouldChangeDecision: evaluation?.wouldChangeDecision ?? true,
        confidence: evaluation?.confidence ?? 0.5,
      };
    });
  } catch (err) {
    logger.warn("Ablation filter failed, keeping all facts: %s", (err as Error).message);
    return facts.map((fact) => ({
      fact,
      wouldChangeDecision: true,
      confidence: 0.5,
    }));
  }
}

export function filterCriticalFacts(results: AblationResult[]): AblationResult[] {
  return results.filter((r) => r.wouldChangeDecision);
}
