import { createMiddleware } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { ContextGraphConfig } from "../types/config.js";
import type { ToolCall } from "../types/data-model.js";
import type { ContextualRegistry } from "./contextual-registry.js";
import { ablationFilter, filterCriticalFacts } from "./ablation-filter.js";
import { createLogger, type Logger } from "../utils/logger.js";

export function createReasoningExtractor(
  config: ContextGraphConfig,
  registry: ContextualRegistry,
  observerModel: BaseChatModel | null
) {
  const logger = createLogger(config.debug);

  return createMiddleware({
    name: "ContextGraphReasoningExtractor",

    wrapModelCall: async (request, handler) => {
      const response = await handler(request);

      // Extract content from model response
      const responseMessage = response;
      const content =
        typeof responseMessage.content === "string"
          ? responseMessage.content
          : "";

      const toolCalls = (responseMessage as any).tool_calls ?? [];

      // If no tool calls, agent is finishing — save the decision trace.
      // The trace captures the intent (user message), action (agent response),
      // and any reasoning facts from the conversation history.
      if (toolCalls.length === 0 && content) {
        const messages = request.messages ?? [];
        const facts = extractFactsFromMessages(messages);
        const capturedToolCalls = extractToolCalls(messages);
        logger.debug("Extracted %d fact(s), %d tool call(s) from %d message(s)", facts.length, capturedToolCalls.length, messages.length);
        const decision = content;

        try {
          await saveDecisionTrace(
            facts,
            decision,
            messages,
            capturedToolCalls,
            config,
            registry,
            observerModel,
            logger
          );
        } catch (err) {
          logger.warn(
            "Failed to save decision trace: %s",
            (err as Error).message
          );
        }
      }

      return response;
    },

    wrapToolCall: async (request, handler) => {
      const result = await handler(request);
      // Tool calls are captured via messages in the next model call
      return result;
    },
  });
}

/**
 * Extract reasoning facts from messages.
 * Only captures actual reasoning statements from the AI — NOT tool call
 * strings or raw tool output, which are noise and should not become constraints.
 */
function extractFactsFromMessages(messages: unknown[]): string[] {
  const facts: string[] = [];

  for (const msg of messages) {
    const message = msg as any;
    const role = message._getType?.() ?? message.role ?? "";
    const content =
      typeof message.content === "string" ? message.content : "";

    if (role === "ai" || role === "assistant") {
      // Only extract reasoning from AI messages that have NO tool calls
      // (messages with tool calls are just "I'm going to use X" — not reasoning)
      const toolCalls = message.tool_calls ?? [];
      if (toolCalls.length === 0 && content) {
        const sentences = content
          .split(/[.!?]\s+/)
          .filter((s: string) => s.trim().length > 20);
        facts.push(...sentences.slice(0, 5));
      }
    }
    // Tool results are captured separately as ToolCall nodes — they don't need
    // to be facts/constraints. The actual reasoning about tool results comes
    // from the AI's interpretation in subsequent messages.
  }

  return facts;
}

/** Extract ToolCall nodes from message history for graph storage. */
function extractToolCalls(messages: unknown[]): ToolCall[] {
  const toolCalls: ToolCall[] = [];
  const now = new Date().toISOString();

  // Build a map of tool call IDs to their results
  const toolResults = new Map<string, string>();
  for (const msg of messages) {
    const message = msg as any;
    const role = message._getType?.() ?? message.role ?? "";
    if (role === "tool") {
      const callId = message.tool_call_id ?? "";
      const content =
        typeof message.content === "string" ? message.content : "";
      if (callId) {
        toolResults.set(callId, content.substring(0, 500));
      }
    }
  }

  // Extract tool calls from AI messages
  for (const msg of messages) {
    const message = msg as any;
    const role = message._getType?.() ?? message.role ?? "";
    if (role === "ai" || role === "assistant") {
      const calls = message.tool_calls ?? [];
      for (const tc of calls) {
        toolCalls.push({
          name: tc.name,
          args: JSON.stringify(tc.args),
          result: toolResults.get(tc.id) ?? undefined,
          createdAt: now,
        });
      }
    }
  }

  return toolCalls;
}

async function saveDecisionTrace(
  facts: string[],
  decision: string,
  messages: unknown[],
  capturedToolCalls: ToolCall[],
  config: ContextGraphConfig,
  registry: ContextualRegistry,
  observerModel: BaseChatModel | null,
  logger: Logger
): Promise<void> {
  const isDiscovery = await registry.isDiscoveryMode();

  let criticalFacts = facts;
  let ablationScore: number | undefined;

  // Apply ablation filter unless in discovery mode
  if (!isDiscovery && observerModel) {
    const results = await ablationFilter(facts, decision, observerModel, logger);
    const critical = filterCriticalFacts(results);
    criticalFacts = critical.map((r) => r.fact);
    ablationScore =
      critical.length > 0
        ? critical.reduce((sum, r) => sum + r.confidence, 0) /
          critical.length
        : undefined;
  }

  // Extract intent from the first user message
  const userMessages = messages.filter(
    (m: any) => (m._getType?.() ?? m.role) === "human" || (m._getType?.() ?? m.role) === "user"
  );
  const intentDescription =
    userMessages.length > 0
      ? typeof (userMessages[0] as any).content === "string"
        ? (userMessages[0] as any).content
        : "Unknown intent"
      : "Unknown intent";

  // Use LLM for structured extraction if observer model is available
  let constraints: { description: string; type: "blocker" | "permission" | "pivot"; createdAt: string }[];
  let concepts: string[];
  let domain: string;

  if (observerModel) {
    const extraction = await extractStructuredContext(
      intentDescription,
      decision,
      criticalFacts,
      observerModel,
      logger
    );
    constraints = extraction.constraints.map((c) => ({
      ...c,
      createdAt: new Date().toISOString(),
    }));
    concepts = extraction.concepts;
    domain = config.domain ?? extraction.domain;
  } else {
    // Fallback to heuristic extraction — only create constraints from
    // facts that contain actual reasoning (not tool artifacts)
    constraints = criticalFacts
      .filter((fact) => fact.length > 20 && fact.length < 300)
      .slice(0, 5)  // Cap at 5 constraints max
      .map((fact) => ({
        description: fact,
        type: classifyFact(fact),
        createdAt: new Date().toISOString(),
      }));
    concepts = extractConceptsFallback(intentDescription, decision, criticalFacts);
    domain = config.domain ?? inferDomainFallback(intentDescription, decision);
  }

  const trace = {
    intent: {
      description: intentDescription,
      createdAt: new Date().toISOString(),
    },
    constraints,
    action: {
      description: decision.substring(0, 500),
      outcome: "pending" as const,
      createdAt: new Date().toISOString(),
    },
    justification: {
      description: criticalFacts.length > 0
        ? criticalFacts.join("; ")
        : buildJustificationSummary(intentDescription, capturedToolCalls),
      confidence: isDiscovery ? 0.5 : (ablationScore ?? 0.5),
      ablationScore,
    },
    toolCalls: capturedToolCalls,
    project: config.project,
    tenant: config.tenant,
    domain,
    agent: config.agent,
    concepts,
    status: "captured" as const,
  };

  await registry.recordDecision(trace);
}

// ── LLM-Powered Extraction ──────────────────────────────────────────────────

const EXTRACTION_SYSTEM_PROMPT = `You are a Context Extraction Engine for an AI agent's decision graph.
Given the agent's intent, decision, and facts, extract structured metadata.

Respond with valid JSON matching this schema:
{
  "domain": "<string: the domain this interaction belongs to, e.g. 'tech', 'legal', 'medical', 'finance', 'support', 'devops', or a more specific domain>",
  "concepts": ["<string: semantic tags/concepts, e.g. 'account-lockout', 'api-authentication', 'contract-review'>"],
  "constraints": [
    {
      "description": "<string: what the constraint is>",
      "type": "<'blocker' | 'permission' | 'pivot'>"
    }
  ],
  "entities": [
    {
      "label": "<string: PascalCase entity type discovered, e.g. 'ErrorPattern', 'APIEndpoint'>",
      "name": "<string: specific name of this entity>"
    }
  ]
}

Guidelines:
- **domain**: Be specific. "software-engineering" is better than "tech". Use existing domain names when applicable.
- **concepts**: Extract 1-5 semantic tags that would help find this decision trace later. Think about what future queries would match.
- **constraints**: Classify each critical fact:
  - "blocker": something that prevents or blocks an action
  - "permission": something that enables or allows an action
  - "pivot": a condition that changes the approach or priority
- **entities**: Identify domain-specific entities the agent discovered. Only include genuinely new concepts, not generic ones.

Be precise. Quality over quantity.`;

interface StructuredExtraction {
  domain: string;
  concepts: string[];
  constraints: { description: string; type: "blocker" | "permission" | "pivot" }[];
  entities: { label: string; name: string }[];
}

async function extractStructuredContext(
  intent: string,
  decision: string,
  facts: string[],
  model: BaseChatModel,
  logger: Logger
): Promise<StructuredExtraction> {
  const prompt = `## Agent Intent
${intent}

## Decision Made
${decision.substring(0, 500)}

## Critical Facts
${facts.map((f, i) => `[${i}] ${f}`).join("\n")}

Extract the domain, concepts, constraints, and entities. Respond with valid JSON only.`;

  try {
    const response = await model.invoke([
      new SystemMessage(EXTRACTION_SYSTEM_PROMPT),
      new HumanMessage(prompt),
    ]);

    const content =
      typeof response.content === "string"
        ? response.content
        : JSON.stringify(response.content);

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      logger.warn("Structured extraction: no JSON found in response");
      return fallbackExtraction(intent, decision, facts);
    }

    const parsed = JSON.parse(jsonMatch[0]) as StructuredExtraction;

    // Validate and sanitize
    return {
      domain: typeof parsed.domain === "string" ? parsed.domain : "general",
      concepts: Array.isArray(parsed.concepts)
        ? parsed.concepts.filter((c): c is string => typeof c === "string").slice(0, 10)
        : [],
      constraints: Array.isArray(parsed.constraints)
        ? parsed.constraints
            .filter((c) => c && typeof c.description === "string")
            .map((c) => ({
              description: c.description,
              type: (["blocker", "permission", "pivot"].includes(c.type) ? c.type : "pivot") as "blocker" | "permission" | "pivot",
            }))
        : facts.map((f) => ({ description: f, type: "pivot" as const })),
      entities: Array.isArray(parsed.entities)
        ? parsed.entities.filter((e) => e && typeof e.label === "string")
        : [],
    };
  } catch (err) {
    logger.warn("Structured extraction failed: %s", (err as Error).message);
    return fallbackExtraction(intent, decision, facts);
  }
}

function fallbackExtraction(
  intent: string,
  decision: string,
  facts: string[]
): StructuredExtraction {
  return {
    domain: inferDomainFallback(intent, decision),
    concepts: extractConceptsFallback(intent, decision, facts),
    constraints: facts.map((f) => ({
      description: f,
      type: classifyFact(f),
    })),
    entities: [],
  };
}

// ── Heuristic Fallbacks (used when no observer model is available) ───────────

function classifyFact(fact: string): "blocker" | "permission" | "pivot" {
  const lower = fact.toLowerCase();
  if (
    lower.includes("cannot") ||
    lower.includes("error") ||
    lower.includes("fail") ||
    lower.includes("block") ||
    lower.includes("timeout") ||
    lower.includes("denied")
  ) {
    return "blocker";
  }
  if (
    lower.includes("allow") ||
    lower.includes("permit") ||
    lower.includes("access") ||
    lower.includes("grant") ||
    lower.includes("auth")
  ) {
    return "permission";
  }
  return "pivot";
}

function extractConceptsFallback(
  intent: string,
  decision: string,
  facts: string[]
): string[] {
  const combined = `${intent} ${decision} ${facts.join(" ")}`.toLowerCase();
  const concepts: string[] = [];

  const patterns: [RegExp, string][] = [
    [/\baccount\s*\w*\s*(lock|block|suspend)|lock\w*\s*(account|out)/i, "account-lockout"],
    [/\bcan'?t\s*(log\s*in|sign\s*in)|login\s*(fail|error|issue)/i, "account-lockout"],
    [/\bpassword\s*\w*\s*(reset|change|forgot)|forgot\w*\s*password/i, "password-reset"],
    [/\brate\s*limit/i, "rate-limiting"],
    [/\b429\b|\btoo many requests/i, "rate-limiting"],
    [/\bbilling|payment|invoice|refund/i, "billing"],
    [/\bapi\s*(key|token|auth)/i, "api-authentication"],
    [/\bescalat/i, "escalation"],
    [/\btimeout|latency|slow/i, "performance"],
    [/\bpermission|rbac|role|access control/i, "access-control"],
    [/\bdeployment|deploy|release/i, "deployment"],
    [/\bbug|defect|regression/i, "bug-fix"],
    [/\brefactor/i, "refactoring"],
    [/\bonboard/i, "onboarding"],
    [/\bmigrat/i, "migration"],
    [/\bdiagnos|symptom|treatment|patient/i, "clinical-decision"],
    [/\bcontract|clause|compliance|regulat/i, "compliance"],
    [/\bliabilit|negligence|statute/i, "legal-risk"],
    [/\bprescri|dosage|medication/i, "medication"],
  ];

  for (const [pattern, tag] of patterns) {
    if (pattern.test(combined) && !concepts.includes(tag)) {
      concepts.push(tag);
    }
  }

  return concepts;
}

/** Build a concise justification when no reasoning facts are available. */
function buildJustificationSummary(intent: string, toolCalls: ToolCall[]): string {
  const parts: string[] = [];
  if (toolCalls.length > 0) {
    const toolNames = [...new Set(toolCalls.map((tc) => tc.name))];
    parts.push(`Used ${toolNames.join(", ")}`);
  }
  const intentShort = intent.length > 80 ? intent.substring(0, 80) + "..." : intent;
  parts.push(`to address: ${intentShort}`);
  return parts.join(" ");
}

function inferDomainFallback(intent: string, decision: string): string {
  const combined = `${intent} ${decision}`.toLowerCase();

  if (/\bapi\b|\bendpoint|\bsdk\b|\brate.?limit|\b429\b/.test(combined)) return "tech";
  if (/\bbilling|\bpayment|\binvoice|\brefund|\bsubscription/.test(combined)) return "finance";
  if (/\baccount|\blogin|\bpassword|\bauth|\block/.test(combined)) return "support";
  if (/\blegal|\bcompliance|\bregulat|\bpolicy|\bcontract|\bliabilit/.test(combined)) return "legal";
  if (/\bmedical|\bpatient|\bdiagnos|\btreatment|\bprescri|\bsymptom/.test(combined)) return "medical";

  return "general";
}
