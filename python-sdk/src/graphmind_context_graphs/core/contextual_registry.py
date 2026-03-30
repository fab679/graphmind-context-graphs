"""ContextualRegistry — semantic retrieval and decision recording."""

from __future__ import annotations

from ..types.config import ContextGraphConfig, DEFAULT_SIMILARITY_THRESHOLD, DEFAULT_VECTOR_SEARCH_LIMIT
from ..types.data_model import DecisionTrace, FormattedContext, ScoredDecisionTrace
from ..embeddings.provider import EmbeddingProvider
from ..db.client import GraphmindStore
from ..utils.logger import create_logger


class ContextualRegistry:
    def __init__(self, store: GraphmindStore, embedding_provider: EmbeddingProvider, config: ContextGraphConfig) -> None:
        self._store = store
        self._embedding = embedding_provider
        self._config = config
        self._logger = create_logger(config.debug)
        self._discovery_mode: bool | None = None

    def is_discovery_mode(self) -> bool:
        if self._discovery_mode is not None:
            return self._discovery_mode
        count = self._store.count_traces()
        self._discovery_mode = count == 0
        if self._discovery_mode:
            self._logger.info("Discovery Mode: no prior traces found for this project")
        return self._discovery_mode

    def get_relevant_context(self, intent_description: str) -> FormattedContext:
        embedding = self._embedding.embed(intent_description)
        limit = self._config.vector_search_limit or DEFAULT_VECTOR_SEARCH_LIMIT

        past_traces = self._store.find_similar_traces(embedding, limit)
        rules = self._store.get_active_rules()
        anti_patterns = self._store.get_anti_patterns()
        skills = self._store.get_skills_by_project()
        schema = self._store.get_schema_overview()

        self._logger.debug(
            "Retrieved context: %d traces, %d rules, %d anti-patterns, %d skills, %d entity types",
            len(past_traces), len(rules), len(anti_patterns), len(skills), len(schema.node_labels),
        )

        return FormattedContext(
            past_traces=past_traces,
            rules=rules,
            anti_patterns=anti_patterns,
            skills=skills,
            schema=schema,
        )

    def record_decision(self, trace: DecisionTrace) -> str:
        """Save a decision trace with auto-generated embeddings."""
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

        trace_id = self._store.save_decision_trace(trace)

        # Embed concepts
        if trace.concepts:
            try:
                concept_embeddings = self._embedding.embed_batch(trace.concepts)
                for i, name in enumerate(trace.concepts):
                    self._store.ensure_concept(name, embedding=concept_embeddings[i])
            except Exception as e:
                self._logger.debug("Failed to embed concepts: %s", e)

        # Link precedents
        self._link_precedents(trace_id, trace_emb)

        # Reset discovery mode
        self._discovery_mode = None

        self._logger.debug("Recorded decision trace: %s", trace_id)
        return trace_id

    def _link_precedents(self, new_trace_id: str, embedding: list[float]) -> None:
        threshold = self._config.similarity_threshold or DEFAULT_SIMILARITY_THRESHOLD
        similar = self._store.find_similar_traces(embedding, 5)
        for scored in similar:
            if scored.trace.id and scored.trace.id != new_trace_id and scored.similarity >= threshold:
                self._store.create_precedent_link(new_trace_id, scored.trace.id, scored.similarity)
