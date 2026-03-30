from __future__ import annotations
from dataclasses import dataclass, field
from typing import Literal

TraceStatus = Literal["captured", "validated", "synthesized", "anti_pattern", "pruned"]
ContextSharingPolicy = Literal["shared", "isolated", "selective"]


@dataclass
class Intent:
    description: str
    created_at: str
    id: str | None = None
    embedding: list[float] | None = None


@dataclass
class Constraint:
    description: str
    type: Literal["blocker", "permission", "pivot"]
    created_at: str
    id: str | None = None
    embedding: list[float] | None = None


@dataclass
class Action:
    description: str
    created_at: str
    id: str | None = None
    outcome: Literal["success", "failure", "pending"] | None = None
    embedding: list[float] | None = None


@dataclass
class Justification:
    description: str
    confidence: float
    ablation_score: float | None = None


@dataclass
class ToolCallRecord:
    """Records an individual tool invocation."""
    name: str
    args: str
    created_at: str
    id: str | None = None
    result: str | None = None
    duration_ms: int | None = None


@dataclass
class AgentNode:
    name: str
    created_at: str
    id: str | None = None
    description: str | None = None


@dataclass
class Domain:
    name: str
    created_at: str
    id: str | None = None
    description: str | None = None


@dataclass
class Project:
    name: str
    tenant: str
    created_at: str
    id: str | None = None
    description: str | None = None


@dataclass
class Concept:
    name: str
    created_at: str
    id: str | None = None
    description: str | None = None
    embedding: list[float] | None = None


@dataclass
class Skill:
    name: str
    description: str
    prompt: str
    confidence: float
    concepts: list[str]
    tools: list[str]
    trace_count: int
    created_at: str
    updated_at: str
    id: str | None = None
    domain: str | None = None


@dataclass
class DecisionTrace:
    intent: Intent
    constraints: list[Constraint]
    action: Action
    justification: Justification
    project: str
    tenant: str
    status: TraceStatus
    created_at: str
    updated_at: str
    id: str | None = None
    tool_calls: list[ToolCallRecord] | None = None
    domain: str | None = None
    agent: str | None = None
    concepts: list[str] | None = None
    embedding: list[float] | None = None


@dataclass
class ScoredDecisionTrace:
    trace: DecisionTrace
    similarity: float


@dataclass
class GraphEntity:
    """A dynamic entity created by an agent to map domain knowledge."""
    label: str
    properties: dict[str, str | int | float | bool]
    created_at: str
    id: str | None = None
    created_by: str | None = None


@dataclass
class GraphRelationship:
    """A dynamic relationship between two entities."""
    source_id: str
    target_id: str
    type: str
    created_at: str
    id: str | None = None
    properties: dict[str, str | int | float | bool] | None = None
    created_by: str | None = None


@dataclass
class SchemaOverview:
    """Schema overview returned by Graphmind schema introspection."""
    node_labels: list[str]
    relationship_types: list[str]
    node_counts: dict[str, int]
    edge_counts: dict[str, int]


@dataclass
class FormattedContext:
    past_traces: list[ScoredDecisionTrace]
    rules: list[DecisionTrace]
    anti_patterns: list[DecisionTrace]
    skills: list[Skill]
    schema: SchemaOverview | None = None
