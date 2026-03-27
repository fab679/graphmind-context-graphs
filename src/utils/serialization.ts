import type {
  DecisionTrace,
  Intent,
  Constraint,
  Action,
  Justification,
  TraceStatus,
} from "../types/data-model.js";

export function traceToProperties(
  trace: Omit<DecisionTrace, "id" | "createdAt" | "updatedAt">
): Record<string, unknown> {
  return {
    project: trace.project,
    tenant: trace.tenant,
    status: trace.status,
    justification_description: trace.justification.description,
    justification_confidence: trace.justification.confidence,
    justification_ablationScore: trace.justification.ablationScore ?? null,
    embedding: trace.embedding ?? null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export function intentToProperties(intent: Omit<Intent, "id">): Record<string, unknown> {
  return {
    description: intent.description,
    embedding: intent.embedding ?? null,
    createdAt: intent.createdAt,
  };
}

export function constraintToProperties(
  constraint: Omit<Constraint, "id">
): Record<string, unknown> {
  return {
    description: constraint.description,
    type: constraint.type,
    embedding: constraint.embedding ?? null,
    createdAt: constraint.createdAt,
  };
}

export function actionToProperties(action: Omit<Action, "id">): Record<string, unknown> {
  return {
    description: action.description,
    outcome: action.outcome ?? "pending",
    embedding: action.embedding ?? null,
    createdAt: action.createdAt,
  };
}

export function recordToTrace(_record: Record<string, unknown>[]): DecisionTrace {
  // This is a helper for parsing flat query results back into DecisionTrace
  // The actual parsing depends on the query structure
  throw new Error("Use parseTraceFromNodes instead");
}

export function parseTraceFromNodes(
  traceProps: Record<string, unknown>,
  intentProps: Record<string, unknown>,
  constraintPropsList: Record<string, unknown>[],
  actionProps: Record<string, unknown>
): DecisionTrace {
  const intent: Intent = {
    id: String(intentProps.id ?? ""),
    description: String(intentProps.description ?? ""),
    embedding: intentProps.embedding as number[] | undefined,
    createdAt: String(intentProps.createdAt ?? ""),
  };

  const constraints: Constraint[] = constraintPropsList.map((cp) => ({
    id: String(cp.id ?? ""),
    description: String(cp.description ?? ""),
    type: String(cp.type ?? "blocker") as Constraint["type"],
    embedding: cp.embedding as number[] | undefined,
    createdAt: String(cp.createdAt ?? ""),
  }));

  const action: Action = {
    id: String(actionProps.id ?? ""),
    description: String(actionProps.description ?? ""),
    outcome: actionProps.outcome
      ? (String(actionProps.outcome) as Action["outcome"])
      : undefined,
    embedding: actionProps.embedding as number[] | undefined,
    createdAt: String(actionProps.createdAt ?? ""),
  };

  const justification: Justification = {
    description: String(traceProps.justification_description ?? ""),
    confidence: Number(traceProps.justification_confidence ?? 0),
    ablationScore: traceProps.justification_ablationScore
      ? Number(traceProps.justification_ablationScore)
      : undefined,
  };

  return {
    id: String(traceProps.id ?? ""),
    intent,
    constraints,
    action,
    justification,
    project: String(traceProps.project ?? ""),
    tenant: String(traceProps.tenant ?? ""),
    status: String(traceProps.status ?? "captured") as TraceStatus,
    embedding: traceProps.embedding as number[] | undefined,
    createdAt: String(traceProps.createdAt ?? ""),
    updatedAt: String(traceProps.updatedAt ?? ""),
  };
}
