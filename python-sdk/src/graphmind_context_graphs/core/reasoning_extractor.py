"""Reasoning Extractor — captures decision traces from agent conversations."""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from langchain.agents.middleware import AgentMiddleware, ModelRequest, ModelResponse
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from ..types.config import ContextGraphConfig
from ..types.data_model import DecisionTrace, Intent, Action, Justification, ToolCallRecord
from .contextual_registry import ContextualRegistry
from ..db.multi_tenant_store import RuntimeTenantContext
from ..utils.logger import create_logger


class ReasoningExtractorMiddleware(AgentMiddleware):
    """LangChain middleware that captures decision traces from agent conversations."""

    def __init__(self, config: ContextGraphConfig, registry: ContextualRegistry,
                 observer_model: BaseChatModel | None = None) -> None:
        super().__init__()
        self._config = config
        self._registry = registry
        self._observer_model = observer_model
        self._logger = create_logger(config.debug)

    def wrap_model_call(self, request: ModelRequest, handler: Callable) -> Any:
        response = handler(request)

        # Extract the AI message from ModelResponse.result
        ai_msg = None
        result_msgs = getattr(response, "result", None)
        if isinstance(result_msgs, list):
            for msg in result_msgs:
                if isinstance(msg, AIMessage):
                    ai_msg = msg
                    break

        if ai_msg is None:
            return response

        content = getattr(ai_msg, "content", "")
        if isinstance(content, list):
            content = " ".join(str(b) for b in content)
        tool_calls = getattr(ai_msg, "tool_calls", []) or []

        # If no tool calls, agent is finishing — save the decision trace
        if not tool_calls and content:
            messages = request.messages or []
            facts = _extract_facts(messages)
            captured_tools = _extract_tool_calls(messages)
            self._logger.debug("Extracted %d fact(s), %d tool call(s) from %d message(s)",
                               len(facts), len(captured_tools), len(messages))

            # Extract runtime tenant context from request
            runtime_context = self._extract_runtime_context(request)

            try:
                _save_decision_trace(
                    facts, content, messages, captured_tools,
                    self._config, self._registry, self._observer_model, self._logger,
                    runtime_context,
                )
            except Exception as e:
                self._logger.warning("Failed to save decision trace: %s", e)

        return response

    def _extract_runtime_context(self, request: ModelRequest) -> RuntimeTenantContext | None:
        """Extract runtime tenant context from the request."""
        ctx = getattr(request, "context", None)
        if not ctx:
            return None

        # Handle dict-like context
        if isinstance(ctx, dict):
            return RuntimeTenantContext(
                tenant=ctx.get("tenant"),
                project=ctx.get("project"),
                agent=ctx.get("agent"),
                agent_description=ctx.get("agent_description"),
            )

        # Handle object with attributes
        return RuntimeTenantContext(
            tenant=getattr(ctx, "tenant", None),
            project=getattr(ctx, "project", None),
            agent=getattr(ctx, "agent", None),
            agent_description=getattr(ctx, "agent_description", None),
        )


def _extract_facts(messages: list) -> list[str]:
    """Extract reasoning facts from AI messages (not tool artifacts)."""
    facts: list[str] = []
    for msg in messages:
        role = getattr(msg, "type", None) or getattr(msg, "role", "")
        content = getattr(msg, "content", "")
        if isinstance(content, list):
            content = " ".join(str(b) for b in content)

        if role in ("ai", "assistant"):
            tool_calls = getattr(msg, "tool_calls", []) or []
            if not tool_calls and content:
                sentences = re.split(r"[.!?]\s+", content)
                facts.extend(s.strip() for s in sentences if len(s.strip()) > 20)
                facts = facts[:5]
    return facts


def _extract_tool_calls(messages: list) -> list[ToolCallRecord]:
    """Extract tool call records from message history."""
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    tool_results: dict[str, str] = {}
    for msg in messages:
        role = getattr(msg, "type", None) or getattr(msg, "role", "")
        if role == "tool":
            call_id = getattr(msg, "tool_call_id", "")
            content = getattr(msg, "content", "")
            if isinstance(content, list):
                content = " ".join(str(b) for b in content)
            if call_id:
                tool_results[call_id] = str(content)[:500]

    records = []
    for msg in messages:
        role = getattr(msg, "type", None) or getattr(msg, "role", "")
        if role in ("ai", "assistant"):
            for tc in (getattr(msg, "tool_calls", []) or []):
                records.append(ToolCallRecord(
                    name=tc.get("name", ""),
                    args=json.dumps(tc.get("args", {})),
                    result=tool_results.get(tc.get("id", "")),
                    created_at=now,
                ))
    return records


def _save_decision_trace(
    facts: list[str], decision: str, messages: list,
    tool_calls: list[ToolCallRecord], config: ContextGraphConfig,
    registry: ContextualRegistry, observer_model: BaseChatModel | None,
    logger: Any, runtime_context: RuntimeTenantContext | None = None,
) -> None:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    is_discovery = registry.is_discovery_mode(runtime_context)

    critical_facts = facts
    ablation_score = None

    # Extract intent from first user message
    intent_desc = "Unknown intent"
    for msg in messages:
        role = getattr(msg, "type", None) or getattr(msg, "role", "")
        if role in ("human", "user"):
            content = getattr(msg, "content", "")
            if isinstance(content, str) and content:
                intent_desc = content
            break

    # Extract runtime values from context or use config defaults
    runtime_tenant = runtime_context.tenant if runtime_context else None
    runtime_project = runtime_context.project if runtime_context else None
    runtime_agent = runtime_context.agent if runtime_context else None

    # Use LLM extraction if available, otherwise heuristic
    if observer_model:
        extraction = _extract_structured(intent_desc, decision, critical_facts, observer_model, logger)
        constraints = [{"description": c["description"], "type": c["type"], "createdAt": now} for c in extraction.get("constraints", [])]
        concepts = extraction.get("concepts", [])
        domain = config.domain or extraction.get("domain", "general")
    else:
        constraints = [
            {"description": f, "type": _classify_fact(f), "createdAt": now}
            for f in critical_facts if 20 < len(f) < 300
        ][:5]
        concepts = _extract_concepts_fallback(intent_desc, decision, critical_facts)
        domain = config.domain or _infer_domain_fallback(intent_desc, decision)

    # Build justification
    if critical_facts:
        justification_desc = "; ".join(critical_facts)
    else:
        tool_names = list({tc.name for tc in tool_calls})
        parts = []
        if tool_names:
            parts.append(f"Used {', '.join(tool_names)}")
        short_intent = intent_desc[:80] + "..." if len(intent_desc) > 80 else intent_desc
        parts.append(f"to address: {short_intent}")
        justification_desc = " ".join(parts)

    from ..types.data_model import Constraint as ConstraintModel
    trace = DecisionTrace(
        intent=Intent(description=intent_desc, created_at=now),
        constraints=[
            ConstraintModel(description=c["description"], type=c["type"], created_at=now)
            for c in constraints
        ],
        action=Action(description=decision[:500], outcome="pending", created_at=now),
        justification=Justification(
            description=justification_desc,
            confidence=0.5 if is_discovery else (ablation_score or 0.5),
            ablation_score=ablation_score,
        ),
        tool_calls=tool_calls,
        project=runtime_project or config.project,
        tenant=runtime_tenant or config.tenant,
        domain=domain,
        agent=runtime_agent or config.agent,
        concepts=concepts,
        status="captured",
        created_at=now,
        updated_at=now,
    )

    registry.record_decision(trace, runtime_context)


# ── LLM-Powered Extraction ──────────────────────────────────────────────────

EXTRACTION_PROMPT = """You are a Context Extraction Engine. Given the agent's intent, decision, and facts, extract:
{
  "domain": "<string: e.g. 'tech', 'legal', 'medical'>",
  "concepts": ["<semantic tags>"],
  "constraints": [{"description": "<what>", "type": "<blocker|permission|pivot>"}]
}
Respond with valid JSON only."""


def _extract_structured(intent: str, decision: str, facts: list[str],
                         model: BaseChatModel, logger: Any) -> dict:
    prompt = f"## Intent\n{intent}\n\n## Decision\n{decision[:500]}\n\n## Facts\n" + "\n".join(f"[{i}] {f}" for i, f in enumerate(facts))
    try:
        response = model.invoke([SystemMessage(content=EXTRACTION_PROMPT), HumanMessage(content=prompt)])
        content = str(getattr(response, "content", ""))
        match = re.search(r"\{[\s\S]*\}", content)
        if match:
            return json.loads(match.group(0))
    except Exception as e:
        logger.warning("Structured extraction failed: %s", e)
    return {"domain": "general", "concepts": [], "constraints": []}


# ── Heuristic Fallbacks ──────────────────────────────────────────────────────

def _classify_fact(fact: str) -> str:
    lower = fact.lower()
    if any(w in lower for w in ("cannot", "error", "fail", "block", "timeout", "denied")):
        return "blocker"
    if any(w in lower for w in ("allow", "permit", "access", "grant", "auth")):
        return "permission"
    return "pivot"


def _extract_concepts_fallback(intent: str, decision: str, facts: list[str]) -> list[str]:
    combined = f"{intent} {decision} {' '.join(facts)}".lower()
    patterns = [
        (r"account\s*\w*\s*(lock|block|suspend)|lock\w*\s*(account|out)", "account-lockout"),
        (r"password\s*\w*\s*(reset|change|forgot)", "password-reset"),
        (r"rate\s*limit|429|too many requests", "rate-limiting"),
        (r"billing|payment|invoice|refund", "billing"),
        (r"api\s*(key|token|auth)", "api-authentication"),
        (r"timeout|latency|slow", "performance"),
        (r"deployment|deploy|release", "deployment"),
        (r"bug|defect|regression", "bug-fix"),
        (r"contract|clause|compliance|regulat", "compliance"),
    ]
    concepts = []
    for pattern, tag in patterns:
        if re.search(pattern, combined, re.IGNORECASE) and tag not in concepts:
            concepts.append(tag)
    return concepts


def _infer_domain_fallback(intent: str, decision: str) -> str:
    combined = f"{intent} {decision}".lower()
    if re.search(r"\bapi\b|\bendpoint|\bsdk\b|\brate.?limit|\b429\b", combined): return "tech"
    if re.search(r"\bbilling|\bpayment|\binvoice|\brefund", combined): return "finance"
    if re.search(r"\baccount|\blogin|\bpassword|\bauth|\block", combined): return "support"
    if re.search(r"\blegal|\bcompliance|\bregulat|\bcontract", combined): return "legal"
    if re.search(r"\bmedical|\bpatient|\bdiagnos|\btreatment", combined): return "medical"
    return "general"
