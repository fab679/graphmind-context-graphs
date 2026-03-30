"""KnowledgeLifecycleManager — validate, synthesize, prune decision traces."""

from __future__ import annotations

from datetime import datetime, timezone

from ..types.config import ContextGraphConfig
from ..types.data_model import Skill
from ..types.lifecycle import ValidationResult, LifecycleStats, DEFAULT_MIN_SUCCESS_COUNT
from ..db.client import GraphmindStore
from ..utils.logger import create_logger

DEFAULT_MIN_TRACES_FOR_SKILL = 2


class KnowledgeLifecycleManager:
    def __init__(self, store: GraphmindStore, config: ContextGraphConfig) -> None:
        self._store = store
        self._logger = create_logger(config.debug)

    def validate_trace(self, trace_id: str, result: ValidationResult) -> None:
        trace = self._store.get_trace_by_id(trace_id)
        if not trace:
            raise ValueError(f"Trace not found: {trace_id}")

        current = trace.justification.confidence
        new_conf = min(1, current + 0.1) if result.success else max(0, current - 0.15)

        self._store.update_trace_status_and_confidence(trace_id, "validated", new_conf)
        self._logger.info("Validated trace %s: %s (confidence: %.2f -> %.2f)",
                          trace_id, "success" if result.success else "failure", current, new_conf)

    def synthesize_rules(self, min_confidence: float = 0.7) -> list[str]:
        candidates = self._store.get_candidates_for_synthesis(min_confidence)
        promoted = []
        for trace in candidates:
            if trace.id and trace.justification.confidence >= min_confidence:
                self._store.update_trace_status(trace.id, "synthesized")
                promoted.append(trace.id)
                self._logger.info("Promoted trace %s to rule (confidence: %.2f)", trace.id, trace.justification.confidence)
        self._logger.info("Synthesized %d new rules", len(promoted))
        return promoted

    def prune_failures(self, max_confidence: float = 0.2) -> list[str]:
        candidate_ids = self._store.get_candidates_for_pruning(max_confidence)
        for trace_id in candidate_ids:
            self._store.update_trace_status(trace_id, "anti_pattern")
            self._logger.info("Marked trace %s as anti-pattern", trace_id)
        self._logger.info("Pruned %d traces as anti-patterns", len(candidate_ids))
        return candidate_ids

    def synthesize_skills(self, min_traces: int = DEFAULT_MIN_TRACES_FOR_SKILL) -> list[str]:
        # This would use get_synthesized_traces_by_concept - simplified version
        self._logger.info("Skill synthesis not yet implemented in Python SDK")
        return []

    def get_lifecycle_stats(self) -> LifecycleStats:
        return self._store.get_lifecycle_stats()
