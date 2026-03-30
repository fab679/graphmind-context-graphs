from __future__ import annotations
from dataclasses import dataclass

DEFAULT_MIN_SUCCESS_COUNT = 3
DEFAULT_MIN_FAILURE_COUNT = 2


@dataclass
class ValidationResult:
    trace_id: str
    success: bool
    feedback: str | None = None


@dataclass
class LifecycleStats:
    captured: int = 0
    validated: int = 0
    synthesized: int = 0
    anti_patterns: int = 0
    pruned: int = 0
    total: int = 0
