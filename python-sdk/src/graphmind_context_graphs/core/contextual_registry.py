"""ContextualRegistry — semantic retrieval and decision recording."""

from __future__ import annotations

from ..types.config import ContextGraphConfig, DEFAULT_SIMILARITY_THRESHOLD, DEFAULT_VECTOR_SEARCH_LIMIT
from ..types.data_model import DecisionTrace, FormattedContext, ScoredDecisionTrace
from ..embeddings.provider import EmbeddingProvider
from ..db.multi_tenant_store import MultiTenantGraphmindStore, RuntimeTenantContext
from ..utils.logger import create_logger


class ContextualRegistry:
    def __init__(self, multi_tenant_store: MultiTenantGraphmindStore, embedding_provider: EmbeddingProvider, config: ContextGraphConfig) -> None:
        self._multi_tenant_store = multi_tenant_store
        self._embedding = embedding_provider
        self._config = config
        self._logger = create_logger(config.debug)
        self._discovery_mode: dict[str, bool] = {}

    def is_discovery_mode(self, runtime_context: RuntimeTenantContext | None = None) -> bool:
        store = self._multi_tenant_store.get_store_for_runtime(runtime_context)
        cache_key = store.graph_name

        if cache_key in self._discovery_mode:
            return self._discovery_mode[cache_key]

        count = store.count_traces()
        is_discovery = count == 0
        self._discovery_mode[cache_key] = is_discovery

        if is_discovery:
            self._logger.info(
                "Discovery Mode: no prior traces found for tenant %s, project %s",
                store.tenant,
                store.project,
            )
        return is_discovery

    def get_relevant_context(
        self,
        intent_description: str,
        runtime_context: RuntimeTenantContext | None = None,
    ) -> FormattedContext:
        store = self._multi_tenant_store.get_store_for_runtime(runtime_context)
        embedding = self._embedding.embed(intent_description)
        limit = self._config.vector_search_limit or DEFAULT_VECTOR_SEARCH_LIMIT

        past_traces = store.find_similar_traces(embedding, limit)
        rules = store.get_active_rules()
        anti_patterns = store.get_anti_patterns()
        skills = store.get_skills_by_project()
        schema = store.get_schema_overview()

        self._logger.debug(
            "Retrieved context for tenant %s: %d traces, %d rules, %d anti-patterns, %d skills, %d entity types",
            store.tenant,
            len(past_traces),
            len(rules),
            len(anti_patterns),
            len(skills),
            len(schema.node_labels),
        )

        return FormattedContext(
            past_traces=past_traces,
            rules=rules,
            anti_patterns=anti_patterns,
            skills=skills,
            schema=schema,
        )

    def record_decision(
        self,
        trace: DecisionTrace,
        runtime_context: RuntimeTenantContext | None = None,
    ) -> str:
        """Save a decision trace with auto-generated embeddings."""
        store = self._multi_tenant_store.get_store_for_runtime(runtime_context)

        trace_text = "\n".join([
            f"Intent: {trace.intent.description}",
            *[f"Constraint ({c.type}): {c.description}" for c in trace.constraints],
            f"Action: {trace.action.description}",
            f"Justification: {trace.justification.description}",
        ])

        trace_emb, intent_emb = self._embedding.embed_batch([trace_text, trace.intent.description])
        action_emb = self._embedding.embed(trace.action.description)

        constraint_embeddings = (
            self._embedding.embed_batch([c.description for c in trace.constraints])
            if trace.constraints else []
        )

        # Enrich trace with embeddings
        trace.embedding = trace_emb
        trace.intent.embedding = intent_emb
        trace.action.embedding = action_emb
        for i, c in enumerate(trace.constraints):
            if i < len(constraint_embeddings):
                c.embedding = constraint_embeddings[i]

        trace_id = store.save_decision_trace(trace)

        # Embed concepts
        if trace.concepts:
            try:
                concept_embeddings = self._embedding.embed_batch(trace.concepts)
                for i, name in enumerate(trace.concepts):
                    store.ensure_concept(name, embedding=concept_embeddings[i])
            except Exception as e:
                self._logger.debug("Failed to embed concepts: %s", e)

        # Link precedents
        self._link_precedents(trace_id, trace_emb, store)

        # Reset discovery mode cache for this tenant
        self._discovery_mode.pop(store.graph_name, None)

        self._logger.debug("Recorded decision trace: %s for tenant: %s", trace_id, store.tenant)
        return trace_id

    def _link_precedents(self, new_trace_id: str, embedding: list[float], store) -> None:
        threshold = self._config.similarity_threshold or DEFAULT_SIMILARITY_THRESHOLD
        similar = store.find_similar_traces(embedding, 5)
        for scored in similar:
            if scored.trace.id and scored.trace.id != new_trace_id and scored.similarity >= threshold:
                store.create_precedent_link(new_trace_id, scored.trace.id, scored.similarity)
