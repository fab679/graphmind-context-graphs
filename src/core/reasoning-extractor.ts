import { createMiddleware } from "langchain";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
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

      // If no tool calls, agent is finishing - extract and save trace
      if (toolCalls.length === 0 && content) {
        // Collect reasoning from message history
        const messages = request.messages ?? [];
        const facts = extractFactsFromMessages(messages);
        const capturedToolCalls = extractToolCalls(messages);
        const decision = content;

        // Don't save if no meaningful reasoning was captured
        if (facts.length > 0) {
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

function extractFactsFromMessages(messages: unknown[]): string[] {
  const facts: string[] = [];

  for (const msg of messages) {
    const message = msg as any;
    const role = message._getType?.() ?? message.role ?? "";
    const content =
      typeof message.content === "string" ? message.content : "";

    if (role === "ai" || role === "assistant") {
      // Extract reasoning from AI messages
      if (content) {
        const sentences = content
          .split(/[.!?]\s+/)
          .filter((s: string) => s.trim().length > 10);
        facts.push(...sentences.slice(0, 5));
      }

      // Extract tool call info
      const toolCalls = message.tool_calls ?? [];
      for (const tc of toolCalls) {
        facts.push(
          `Used tool "${tc.name}" with args: ${JSON.stringify(tc.args)}`
        );
      }
    } else if (role === "tool") {
      // Tool results provide factual observations
      if (content && content.length < 500) {
        facts.push(`Observation: ${content}`);
      }
    }
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

  // Build constraints from critical facts
  const constraints = criticalFacts.map((fact) => ({
    description: fact,
    type: classifyFact(fact),
    createdAt: new Date().toISOString(),
  }));

  // Auto-extract concepts/tags from the decision context
  const concepts = extractConcepts(intentDescription, decision, criticalFacts);

  // Detect domain from the config or infer from context
  const domain = config.domain ?? inferDomain(intentDescription, decision);

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
      description: criticalFacts.join("; "),
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

/** Extract concept/tag keywords from the intent, decision, and facts. */
function extractConcepts(
  intent: string,
  decision: string,
  facts: string[]
): string[] {
  const combined = `${intent} ${decision} ${facts.join(" ")}`.toLowerCase();
  const concepts: string[] = [];

  const patterns: [RegExp, string][] = [
    [/\baccount\s*(lock|block|suspend)/i, "account-lockout"],
    [/\bpassword\s*(reset|change|forgot)/i, "password-reset"],
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

/** Infer a domain label from the content if none is explicitly configured. */
function inferDomain(intent: string, decision: string): string {
  const combined = `${intent} ${decision}`.toLowerCase();

  if (/\bapi\b|\bendpoint|\bsdk\b|\brate.?limit|\b429\b/.test(combined)) return "tech";
  if (/\bbilling|\bpayment|\binvoice|\brefund|\bsubscription/.test(combined)) return "finance";
  if (/\baccount|\blogin|\bpassword|\bauth|\block/.test(combined)) return "support";
  if (/\blegal|\bcompliance|\bregulat|\bpolicy|\bcontract|\bliabilit/.test(combined)) return "legal";
  if (/\bmedical|\bpatient|\bdiagnos|\btreatment|\bprescri|\bsymptom/.test(combined)) return "medical";

  return "general";
}
