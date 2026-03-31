"""Dynamic system prompt injection with context from the graph."""

from __future__ import annotations

from langchain.agents.middleware import dynamic_prompt, ModelRequest

from ..types.config import ContextGraphConfig
from ..types.data_model import DecisionTrace, Skill, ScoredDecisionTrace, SchemaOverview
from .contextual_registry import ContextualRegistry
from ..db.multi_tenant_store import RuntimeTenantContext
from .schema_inspector import format_schema_for_prompt
from ..utils.logger import create_logger


def create_prompt_injector(registry: ContextualRegistry, config: ContextGraphConfig):
    logger = create_logger(config.debug)

    @dynamic_prompt
    def context_graph_prompt_injector(request: ModelRequest) -> str:
        messages = request.messages or []

        # Find last user message
        last_user = None
        for msg in reversed(messages):
            role = getattr(msg, "type", None) or getattr(msg, "role", "")
            if role in ("human", "user"):
                last_user = msg
                break

        if not last_user:
            return config.base_system_prompt or ""

        user_content = getattr(last_user, "content", "")
        if isinstance(user_content, list):
            user_content = " ".join(str(b) for b in user_content)
        if not user_content:
            return config.base_system_prompt or ""

        # Extract runtime tenant context from request
        runtime_context = _extract_runtime_context(request)

        try:
            context = registry.get_relevant_context(user_content, runtime_context)
            sections: list[str] = []

            if config.base_system_prompt:
                sections.append(config.base_system_prompt)

            # Add runtime metadata if present
            if runtime_context and runtime_context.tenant:
                runtime_meta = _format_runtime_metadata(runtime_context)
                if runtime_meta:
                    sections.append(runtime_meta)

            # Schema awareness
            if context.schema and context.schema.node_labels:
                schema_section = format_schema_for_prompt(context.schema)
                if schema_section:
                    sections.append(schema_section)
                    logger.info("Injecting schema overview (%d entity types, %d relationship types)",
                                len(context.schema.node_labels), len(context.schema.relationship_types))

            if context.past_traces:
                sections.append(_format_past_logic(context.past_traces))
                logger.info("Injecting %d past trace(s) into system prompt", len(context.past_traces))

            if context.rules:
                sections.append(_format_rules(context.rules))
                logger.info("Injecting %d rule(s) into system prompt", len(context.rules))

            if context.anti_patterns:
                sections.append(_format_anti_patterns(context.anti_patterns))
                logger.info("Injecting %d anti-pattern(s) into system prompt", len(context.anti_patterns))

            if context.skills:
                sections.append(_format_skill_manifest(context.skills))
                logger.info("Injecting %d skill(s) into system prompt", len(context.skills))

            return "\n\n".join(sections)
        except Exception as e:
            logger.warning("Failed to inject context: %s", e)
            return config.base_system_prompt or ""

    return context_graph_prompt_injector


def _extract_runtime_context(request: ModelRequest) -> RuntimeTenantContext | None:
    """Extract runtime tenant context from the request."""
    # LangChain passes runtime context via request.context
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


def _format_runtime_metadata(ctx: RuntimeTenantContext) -> str:
    """Format runtime metadata for injection into system prompt."""
    lines = []
    if ctx.tenant:
        lines.append(f"Tenant: {ctx.tenant}")
    if ctx.project:
        lines.append(f"Project: {ctx.project}")
    if ctx.agent:
        lines.append(f"Agent: {ctx.agent}")
    if ctx.agent_description:
        lines.append(f"Agent description: {ctx.agent_description}")

    if lines:
        return "## Runtime Context\n" + "\n".join(lines)
    return ""


def _truncate(text: str, max_len: int) -> str:
    if not text:
        return ""
    clean = " ".join(text.split())
    return clean if len(clean) <= max_len else clean[: max_len - 1] + "\u2026"


def _format_past_logic(traces: list[ScoredDecisionTrace]) -> str:
    items = []
    for scored in traces:
        t = scored.trace
        intent = _truncate(t.intent.description, 120)
        action = _truncate(t.action.description, 150)
        why = _truncate(t.justification.description, 150)
        domain_tag = f" [{t.domain}]" if t.domain else ""
        concept_tags = ""
        if t.concepts:
            concept_tags = f" tags: {', '.join(f'#{c}' for c in t.concepts)}"

        constraint_lines = [
            f"  - [{c.type}] {_truncate(c.description, 100)}"
            for c in t.constraints[:3]
        ]
        constraint_section = f"\n  **Constraints**:\n" + "\n".join(constraint_lines) if constraint_lines else ""

        items.append(
            f"- **Intent**: {intent} (similarity: {scored.similarity:.2f}){domain_tag}{concept_tags}\n"
            f"  **Action**: {action}\n"
            f"  **Why**: {why}{constraint_section}"
        )

    return (
        "## Relevant Past Logic (Director's Commentary)\n"
        "The following past decisions are relevant to the current task.\n\n"
        + "\n\n".join(items)
    )


def _format_rules(rules: list[DecisionTrace]) -> str:
    items = []
    for r in rules:
        tags = f" [{', '.join(f'#{c}' for c in r.concepts)}]" if r.concepts else ""
        items.append(f"- {r.justification.description} (confidence: {r.justification.confidence:.2f}){tags}")
    return (
        "## Established Rules\n"
        "These patterns have been validated multiple times and should be followed:\n\n"
        + "\n".join(items)
    )


def _format_anti_patterns(anti_patterns: list[DecisionTrace]) -> str:
    items = [f"- AVOID: {r.justification.description} (reason: led to failure)" for r in anti_patterns]
    return (
        "## Anti-Patterns to Avoid\n"
        "These approaches have been tried and consistently failed:\n\n"
        + "\n".join(items)
    )


def _format_skill_manifest(skills: list[Skill]) -> str:
    items = []
    for s in skills:
        domain = f" [{s.domain}]" if s.domain else ""
        tools = f" (tools: {', '.join(s.tools)})" if s.tools else ""
        items.append(f"- **{s.name}**{domain}: {s.description}{tools}")
    return (
        "## Skills System\n"
        "You have access to specialized skills derived from validated decision patterns.\n"
        "When a user's request matches a skill below, use `load_skill` with the skill name.\n\n"
        + "\n".join(items)
    )
