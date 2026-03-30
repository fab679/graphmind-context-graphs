"""GraphmindStore — all database operations for the context graph."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from graphmind import GraphmindClient

from ..types.config import ResolvedContextGraphConfig, DEFAULT_VECTOR_SEARCH_LIMIT, DEFAULT_METRIC
from ..types.data_model import (
    DecisionTrace, TraceStatus, ScoredDecisionTrace, Constraint, Intent,
    Action, Justification, Skill, GraphEntity, GraphRelationship, SchemaOverview,
)
from ..types.lifecycle import LifecycleStats
from ..utils.logger import create_logger
from ..utils.namespace import build_graph_namespace, sanitize_label, sanitize_property, truncate_name
from .queries import (
    TRACE_QUERIES, PROJECT_QUERIES, DOMAIN_QUERIES, CONCEPT_QUERIES,
    AGENT_QUERIES, TOOL_QUERIES, SKILL_QUERIES,
    search_similar_traces_query, search_similar_traces_by_agents_query,
)
from .schema import bootstrap_schema


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


class GraphmindStore:
    def __init__(self, config: ResolvedContextGraphConfig) -> None:
        self._config = config
        self._client = GraphmindClient.connect(config.graphmind.url if config.graphmind else "http://localhost:8080")
        self._graph = build_graph_namespace(config.tenant)
        self._project = config.project
        self._tenant = config.tenant
        self._agent_name = config.agent
        self._context_sharing = config.context_sharing
        self._allowed_agents = config.allowed_agents or []
        self._logger = create_logger(config.debug)

    def initialize(self) -> None:
        metric = self._config.embedding.metric or DEFAULT_METRIC
        bootstrap_schema(self._client, self._graph, self._config.embedding.dimensions, metric, self._logger)
        self.ensure_project()
        if self._agent_name:
            self.ensure_agent(self._agent_name, self._config.agent_description)

    # ── Ensure Methods (standalone MERGE) ──────────────────────────────────────

    def ensure_project(self, description: str | None = None) -> None:
        try:
            q = PROJECT_QUERIES["merge_project"] if description else PROJECT_QUERIES["merge_project_simple"]
            params: dict[str, Any] = {"name": self._project, "tenant": self._tenant, "createdAt": _now()}
            if description:
                params["description"] = description
            self._client.query(q, graph=self._graph, params=params)
        except Exception as e:
            self._logger.warning("Project ensure failed: %s", e)

    def ensure_domain(self, name: str, description: str | None = None) -> None:
        try:
            q = DOMAIN_QUERIES["merge_domain"] if description else DOMAIN_QUERIES["merge_domain_simple"]
            params: dict[str, Any] = {"name": name, "createdAt": _now()}
            if description:
                params["description"] = description
            self._client.query(q, graph=self._graph, params=params)
        except Exception as e:
            self._logger.warning("Domain ensure failed: %s", e)

    def ensure_agent(self, name: str, description: str | None = None) -> None:
        try:
            q = AGENT_QUERIES["merge_agent"] if description else AGENT_QUERIES["merge_agent_simple"]
            params: dict[str, Any] = {"name": name, "createdAt": _now()}
            if description:
                params["description"] = description
            self._client.query(q, graph=self._graph, params=params)
            self._client.query(AGENT_QUERIES["link_agent_to_project"], graph=self._graph, params={
                "agentName": name, "project": self._project, "tenant": self._tenant,
            })
        except Exception as e:
            self._logger.warning("Agent ensure failed: %s", e)

    def ensure_tool(self, name: str) -> None:
        try:
            self._client.query(TOOL_QUERIES["merge_tool"], graph=self._graph, params={"name": name, "createdAt": _now()})
        except Exception as e:
            self._logger.warning("Tool ensure failed: %s", e)

    def ensure_concept(self, name: str, description: str | None = None, embedding: list[float] | None = None) -> None:
        try:
            if description or embedding:
                self._client.query(CONCEPT_QUERIES["merge_concept"], graph=self._graph, params={
                    "name": name, "description": description or "", "embedding": embedding or [], "createdAt": _now(),
                })
            else:
                self._client.query(CONCEPT_QUERIES["merge_concept_simple"], graph=self._graph, params={
                    "name": name, "createdAt": _now(),
                })
            if embedding:
                self._client.query(CONCEPT_QUERIES["update_concept_embedding"], graph=self._graph, params={
                    "name": name, "embedding": embedding,
                })
        except Exception as e:
            self._logger.warning("Concept ensure failed: %s", e)

    def link_agent_to_domain(self, agent_name: str, domain: str) -> None:
        self.ensure_domain(domain)
        try:
            self._client.query(AGENT_QUERIES["link_agent_to_domain"], graph=self._graph, params={
                "agentName": agent_name, "domain": domain,
            })
        except Exception as e:
            self._logger.debug("Agent-domain link: %s", e)

    # ── Decision Trace CRUD ────────────────────────────────────────────────────

    def save_decision_trace(self, trace: DecisionTrace) -> str:
        now = _now()

        result = self._client.query(TRACE_QUERIES["create_decision_trace"], graph=self._graph, params={
            "trace_name": truncate_name(f"{trace.intent.description} → {trace.action.description}"),
            "status": trace.status,
            "justification_description": trace.justification.description,
            "justification_confidence": trace.justification.confidence,
            "justification_ablationScore": trace.justification.ablation_score,
            "trace_embedding": trace.embedding,
            "intent_name": truncate_name(trace.intent.description),
            "intent_description": trace.intent.description,
            "intent_embedding": trace.intent.embedding,
            "action_name": truncate_name(trace.action.description),
            "action_description": trace.action.description,
            "action_outcome": trace.action.outcome or "pending",
            "action_embedding": trace.action.embedding,
            "createdAt": now, "updatedAt": now,
        })

        trace_id = int(result.records[0][0])
        trace_id_str = str(trace_id)

        # Link to Project
        try:
            self.ensure_project()
            self._client.query(TRACE_QUERIES["link_trace_to_project"], graph=self._graph, params={
                "traceId": trace_id, "project": self._project, "tenant": self._tenant,
            })
        except Exception as e:
            self._logger.warning("Failed to link trace to project: %s", e)

        # Link to Domain
        if trace.domain:
            try:
                self.ensure_domain(trace.domain)
                self._client.query(TRACE_QUERIES["link_trace_to_domain"], graph=self._graph, params={
                    "traceId": trace_id, "domain": trace.domain,
                })
            except Exception as e:
                self._logger.warning("Failed to link trace to domain: %s", e)

        # Link to Agent
        agent = trace.agent or self._agent_name
        if agent:
            try:
                self.ensure_agent(agent)
                self._client.query(TRACE_QUERIES["link_trace_to_agent"], graph=self._graph, params={
                    "traceId": trace_id, "agentName": agent,
                })
            except Exception as e:
                self._logger.warning("Failed to link trace to agent: %s", e)
            if trace.domain:
                self.link_agent_to_domain(agent, trace.domain)

        # Create Constraints
        for constraint in trace.constraints:
            try:
                self._client.query(TRACE_QUERIES["create_constraint_for_trace"], graph=self._graph, params={
                    "traceId": trace_id,
                    "name": truncate_name(constraint.description),
                    "description": constraint.description,
                    "type": constraint.type,
                    "embedding": constraint.embedding,
                    "createdAt": now,
                })
            except Exception as e:
                self._logger.warning("Failed to create constraint: %s", e)

        # Link Tools
        if trace.tool_calls:
            for tc in trace.tool_calls:
                try:
                    self.ensure_tool(tc.name)
                    self._client.query(TOOL_QUERIES["link_trace_to_tool"], graph=self._graph, params={
                        "traceId": trace_id, "toolName": tc.name,
                    })
                except Exception as e:
                    self._logger.warning("Failed to link tool usage: %s", e)

        # Tag with Concepts
        if trace.concepts:
            for concept_name in trace.concepts:
                self.tag_trace_with_concept(trace_id_str, concept_name)

        self._logger.debug("Saved decision trace: %s", trace_id_str)
        return trace_id_str

    def tag_trace_with_concept(self, trace_id: str, concept_name: str,
                                description: str | None = None, embedding: list[float] | None = None) -> None:
        self.ensure_concept(concept_name, description, embedding)
        try:
            self._client.query(CONCEPT_QUERIES["link_trace_to_concept"], graph=self._graph, params={
                "traceId": int(trace_id), "conceptName": concept_name,
            })
        except Exception as e:
            self._logger.warning("Failed to tag trace %s with concept '%s': %s", trace_id, concept_name, e)

    def get_trace_by_id(self, trace_id: str) -> DecisionTrace | None:
        result = self._client.query_readonly(TRACE_QUERIES["get_trace_by_id"], graph=self._graph, params={
            "traceId": int(trace_id),
        })
        if not result.records:
            return None
        return _reconstruct_trace_extended(result.records[0])

    # ── Vector Search ──────────────────────────────────────────────────────────

    def find_similar_traces(self, query_vector: list[float], limit: int | None = None) -> list[ScoredDecisionTrace]:
        top_k = limit or self._config.vector_search_limit or DEFAULT_VECTOR_SEARCH_LIMIT
        vector_literal = f"[{', '.join(str(v) for v in query_vector)}]"

        if self._context_sharing == "isolated" and self._agent_name:
            query = search_similar_traces_by_agents_query(vector_literal, top_k, [self._agent_name])
        elif self._context_sharing == "selective" and self._agent_name:
            agents = [self._agent_name] + self._allowed_agents
            query = search_similar_traces_by_agents_query(vector_literal, top_k, agents)
        else:
            query = search_similar_traces_query(vector_literal, top_k)

        try:
            result = self._client.query_readonly(query, graph=self._graph, params={"project": self._project})
            return [
                ScoredDecisionTrace(trace=_reconstruct_trace(r), similarity=float(r[4]))
                for r in (result.records or [])
            ]
        except Exception as e:
            self._logger.warning("Vector search failed: %s", e)
            return []

    # ── Lifecycle Queries ──────────────────────────────────────────────────────

    def update_trace_status(self, trace_id: str, status: TraceStatus) -> None:
        self._client.query(TRACE_QUERIES["update_trace_status"], graph=self._graph, params={
            "traceId": int(trace_id), "status": status, "updatedAt": _now(),
        })

    def update_trace_confidence(self, trace_id: str, confidence: float) -> None:
        self._client.query(TRACE_QUERIES["update_trace_confidence"], graph=self._graph, params={
            "traceId": int(trace_id), "confidence": confidence, "updatedAt": _now(),
        })

    def update_trace_status_and_confidence(self, trace_id: str, status: TraceStatus, confidence: float) -> None:
        self._client.query(TRACE_QUERIES["update_trace_status_and_confidence"], graph=self._graph, params={
            "traceId": int(trace_id), "status": status, "confidence": confidence, "updatedAt": _now(),
        })

    def get_active_rules(self) -> list[DecisionTrace]:
        q = TRACE_QUERIES["get_active_rules_by_agent"] if (self._context_sharing == "isolated" and self._agent_name) else TRACE_QUERIES["get_active_rules"]
        params: dict[str, Any] = {"project": self._project}
        if self._context_sharing == "isolated" and self._agent_name:
            params["agentName"] = self._agent_name
        result = self._client.query_readonly(q, graph=self._graph, params=params)
        return [_reconstruct_trace(r) for r in (result.records or [])]

    def get_anti_patterns(self) -> list[DecisionTrace]:
        q = TRACE_QUERIES["get_anti_patterns_by_agent"] if (self._context_sharing == "isolated" and self._agent_name) else TRACE_QUERIES["get_anti_patterns"]
        params: dict[str, Any] = {"project": self._project}
        if self._context_sharing == "isolated" and self._agent_name:
            params["agentName"] = self._agent_name
        result = self._client.query_readonly(q, graph=self._graph, params=params)
        return [_reconstruct_trace(r) for r in (result.records or [])]

    def count_traces(self) -> int:
        result = self._client.query_readonly(TRACE_QUERIES["count_traces_by_project"], graph=self._graph, params={"project": self._project})
        return int(result.records[0][0]) if result.records else 0

    def get_trace_ids_by_status(self, status: TraceStatus) -> list[str]:
        result = self._client.query_readonly(TRACE_QUERIES["get_trace_ids_by_status"], graph=self._graph, params={
            "project": self._project, "status": status,
        })
        return [str(r[0]) for r in (result.records or [])]

    def get_lifecycle_stats(self) -> LifecycleStats:
        result = self._client.query_readonly(TRACE_QUERIES["get_lifecycle_stats"], graph=self._graph, params={"project": self._project})
        stats = LifecycleStats()
        for record in result.records or []:
            status, count = str(record[0]), int(record[1])
            stats.total += count
            if status == "captured": stats.captured = count
            elif status == "validated": stats.validated = count
            elif status == "synthesized": stats.synthesized = count
            elif status == "anti_pattern": stats.anti_patterns = count
            elif status == "pruned": stats.pruned = count
        return stats

    def get_candidates_for_synthesis(self, min_confidence: float) -> list[DecisionTrace]:
        result = self._client.query_readonly(TRACE_QUERIES["get_candidates_for_synthesis"], graph=self._graph, params={
            "project": self._project, "minConfidence": min_confidence,
        })
        return [_reconstruct_trace(r) for r in (result.records or [])]

    def get_candidates_for_pruning(self, max_confidence: float) -> list[str]:
        result = self._client.query_readonly(TRACE_QUERIES["get_candidates_for_pruning"], graph=self._graph, params={
            "project": self._project, "maxConfidence": max_confidence,
        })
        return [str(r[0]) for r in (result.records or [])]

    def create_precedent_link(self, source_id: str, target_id: str, similarity: float) -> None:
        self._client.query(TRACE_QUERIES["create_precedent_link"], graph=self._graph, params={
            "sourceId": int(source_id), "targetId": int(target_id), "similarity": similarity,
        })

    # ── Tool & Agent Stats ─────────────────────────────────────────────────────

    def get_tool_stats(self) -> list[dict[str, Any]]:
        result = self._client.query_readonly(TOOL_QUERIES["get_tool_stats_by_project"], graph=self._graph, params={"project": self._project})
        return [{"tool_name": str(r[0]), "call_count": int(r[1])} for r in (result.records or [])]

    def get_agents_by_project(self) -> list[dict[str, Any]]:
        result = self._client.query_readonly(AGENT_QUERIES["get_agents_by_project"], graph=self._graph, params={
            "project": self._project, "tenant": self._tenant,
        })
        return [{"name": str(r[0]), "description": str(r[1]) if r[1] else None} for r in (result.records or [])]

    def get_concepts_by_project(self) -> list[dict[str, Any]]:
        result = self._client.query_readonly(CONCEPT_QUERIES["get_concepts_by_project"], graph=self._graph, params={"project": self._project})
        return [{"name": str(r[0]), "description": str(r[1]) if r[1] else None, "trace_count": int(r[2])} for r in (result.records or [])]

    # ── Skills ─────────────────────────────────────────────────────────────────

    def save_skill(self, skill: Skill) -> None:
        try:
            self._client.query(SKILL_QUERIES["merge_skill"], graph=self._graph, params={
                "name": skill.name, "description": skill.description, "prompt": skill.prompt,
                "confidence": skill.confidence, "traceCount": skill.trace_count,
                "createdAt": skill.created_at, "updatedAt": skill.updated_at,
            })
            self._client.query(SKILL_QUERIES["link_skill_to_project"], graph=self._graph, params={
                "skillName": skill.name, "project": self._project, "tenant": self._tenant,
            })
            for concept_name in skill.concepts:
                self.ensure_concept(concept_name)
                try:
                    self._client.query(SKILL_QUERIES["link_skill_to_concept"], graph=self._graph, params={
                        "skillName": skill.name, "conceptName": concept_name,
                    })
                except Exception:
                    pass
            if skill.domain:
                self.ensure_domain(skill.domain)
                try:
                    self._client.query(SKILL_QUERIES["link_skill_to_domain"], graph=self._graph, params={
                        "skillName": skill.name, "domain": skill.domain,
                    })
                except Exception:
                    pass
        except Exception as e:
            self._logger.warning("Failed to save skill '%s': %s", skill.name, e)

    def get_skills_by_project(self) -> list[Skill]:
        result = self._client.query_readonly(SKILL_QUERIES["get_skills_by_project"], graph=self._graph, params={"project": self._project})
        return [_reconstruct_skill(r) for r in (result.records or [])]

    def get_skill_by_name(self, name: str) -> Skill | None:
        result = self._client.query_readonly(SKILL_QUERIES["get_skill_by_name"], graph=self._graph, params={"name": name})
        if not result.records:
            return None
        return _reconstruct_skill_with_tools(result.records[0])

    # ── Schema Introspection ───────────────────────────────────────────────────

    def get_schema_overview(self) -> SchemaOverview:
        try:
            if self._agent_name:
                return self._get_agent_scoped_schema(self._agent_name)
            return self._get_project_scoped_schema()
        except Exception as e:
            self._logger.warning("Schema introspection failed: %s", e)
            return SchemaOverview(node_labels=[], relationship_types=[], node_counts={}, edge_counts={})

    def _get_agent_scoped_schema(self, agent_name: str) -> SchemaOverview:
        params = {"agentName": agent_name}

        node_q = """
            MATCH (n)-[:CREATED_BY]->(ag:Agent {name: $agentName})
            RETURN labels(n) AS nodeLabels, count(n) AS cnt
            UNION ALL
            MATCH (t:DecisionTrace)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
            RETURN labels(t) AS nodeLabels, count(t) AS cnt
            UNION ALL
            MATCH (t:DecisionTrace)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
            MATCH (t)-[]->(related)
            RETURN labels(related) AS nodeLabels, count(related) AS cnt
        """
        rel_q = """
            MATCH (n)-[:CREATED_BY]->(ag:Agent {name: $agentName})
            MATCH (n)-[r]->()
            RETURN type(r) AS relType, count(r) AS cnt
            UNION ALL
            MATCH (t:DecisionTrace)-[:PRODUCED_BY]->(ag:Agent {name: $agentName})
            MATCH (t)-[r]->()
            RETURN type(r) AS relType, count(r) AS cnt
        """

        node_result = self._client.query_readonly(node_q, graph=self._graph, params=params)
        rel_result = self._client.query_readonly(rel_q, graph=self._graph, params=params)
        return self._build_schema(node_result, rel_result)

    def _get_project_scoped_schema(self) -> SchemaOverview:
        params = {"project": self._project, "tenant": self._tenant}
        node_q = "MATCH (n)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project, tenant: $tenant}) RETURN labels(n) AS nodeLabels, count(n) AS cnt"
        rel_q = "MATCH (n)-[:BELONGS_TO_PROJECT]->(p:Project {name: $project, tenant: $tenant}) MATCH (n)-[r]->() RETURN type(r) AS relType, count(r) AS cnt"

        node_result = self._client.query_readonly(node_q, graph=self._graph, params=params)
        rel_result = self._client.query_readonly(rel_q, graph=self._graph, params=params)
        return self._build_schema(node_result, rel_result)

    @staticmethod
    def _build_schema(node_result: Any, rel_result: Any) -> SchemaOverview:
        exclude_labels = {"Agent", "Project", "Domain", "DecisionTrace", "Intent", "Action", "Constraint", "Tool", "Concept", "Skill"}
        exclude_rels = {"MEMBER_OF", "BELONGS_TO_PROJECT", "CREATED_BY", "PRODUCED_BY", "HAS_INTENT", "TOOK_ACTION", "HAS_CONSTRAINT", "USED_TOOL", "TAGGED_WITH", "PRECEDENT_OF", "CONTRIBUTES_TO", "BELONGS_TO_DOMAIN", "OPERATES_IN", "DERIVED_FROM_CONCEPT"}

        node_counts: dict[str, int] = {}
        for r in node_result.records or []:
            raw = r[0]
            label = raw[0] if isinstance(raw, list) else str(raw or "")
            if label:
                node_counts[label] = node_counts.get(label, 0) + int(r[1] or 0)

        edge_counts: dict[str, int] = {}
        for r in rel_result.records or []:
            rel_type = str(r[0] or "")
            if rel_type:
                edge_counts[rel_type] = edge_counts.get(rel_type, 0) + int(r[1] or 0)

        for l in exclude_labels:
            node_counts.pop(l, None)
        for r in exclude_rels:
            edge_counts.pop(r, None)

        return SchemaOverview(
            node_labels=list(node_counts.keys()),
            relationship_types=list(edge_counts.keys()),
            node_counts=node_counts,
            edge_counts=edge_counts,
        )

    # ── Dynamic Entity Management ──────────────────────────────────────────────

    def create_entity(self, entity: GraphEntity) -> str:
        label = sanitize_label(entity.label)
        props: dict[str, Any] = {**entity.properties, "createdAt": entity.created_at}
        if not props.get("name"):
            fallback = entity.properties.get("path") or entity.properties.get("title") or entity.properties.get("description") or entity.properties.get("decision") or next((v for v in entity.properties.values() if isinstance(v, str)), label)
            props["name"] = truncate_name(str(fallback))
        if entity.created_by:
            props["createdBy"] = entity.created_by

        prop_entries = list(props.items())
        set_clause = ", ".join(f"n.{sanitize_property(k)} = $prop_{i}" for i, (k, _) in enumerate(prop_entries))
        params = {f"prop_{i}": v for i, (_, v) in enumerate(prop_entries)}

        result = self._client.query(f"CREATE (n:{label}) SET {set_clause} RETURN id(n) AS entityId", graph=self._graph, params=params)
        entity_id = str(result.records[0][0])

        # Link to project
        try:
            self._client.query(
                "MATCH (n), (p:Project {name: $project, tenant: $tenant}) WHERE id(n) = $entityId CREATE (n)-[:BELONGS_TO_PROJECT]->(p)",
                graph=self._graph, params={"entityId": int(entity_id), "project": self._project, "tenant": self._tenant},
            )
        except Exception as e:
            self._logger.warning("Entity-project link failed: %s", e)

        # Link to agent
        if entity.created_by:
            self.ensure_agent(entity.created_by)
            try:
                self._client.query(
                    "MATCH (n), (ag:Agent {name: $agentName}) WHERE id(n) = $entityId CREATE (n)-[:CREATED_BY]->(ag)",
                    graph=self._graph, params={"entityId": int(entity_id), "agentName": entity.created_by},
                )
            except Exception as e:
                self._logger.warning("Entity-agent link failed: %s", e)

        return entity_id

    def create_relationship(self, rel: GraphRelationship) -> None:
        rel_type = sanitize_label(rel.type)
        params: dict[str, Any] = {"sourceId": int(rel.source_id), "targetId": int(rel.target_id)}

        prop_parts = []
        if rel.properties:
            for i, (k, v) in enumerate(rel.properties.items()):
                prop_parts.append(f"r.{sanitize_property(k)} = $rp_{i}")
                params[f"rp_{i}"] = v
        if rel.created_by:
            prop_parts.append("r.createdBy = $createdBy")
            params["createdBy"] = rel.created_by
        prop_parts.append("r.createdAt = $createdAt")
        params["createdAt"] = rel.created_at

        prop_clause = f" SET {', '.join(prop_parts)}" if prop_parts else ""
        self._client.query(
            f"MATCH (a), (b) WHERE id(a) = $sourceId AND id(b) = $targetId CREATE (a)-[r:{rel_type}]->(b){prop_clause}",
            graph=self._graph, params=params,
        )

    def find_entities(self, label: str, filter_props: dict[str, Any] | None = None) -> list[GraphEntity]:
        safe_label = sanitize_label(label)
        params: dict[str, Any] = {}
        where = ""
        if filter_props:
            conditions = [f"n.{sanitize_property(k)} = $f_{i}" for i, (k, _) in enumerate(filter_props.items())]
            where = f" WHERE {' AND '.join(conditions)}"
            params = {f"f_{i}": v for i, (_, v) in enumerate(filter_props.items())}

        result = self._client.query_readonly(f"MATCH (n:{safe_label}){where} RETURN n ORDER BY n.createdAt DESC LIMIT 50", graph=self._graph, params=params)
        entities = []
        for r in result.records or []:
            node = r[0]
            props = node.get("properties", node) if isinstance(node, dict) else {}
            entities.append(GraphEntity(
                id=str(node.get("id", "")),
                label=safe_label,
                properties=dict(props),
                created_by=str(props.get("createdBy")) if props.get("createdBy") else None,
                created_at=str(props.get("createdAt", "")),
            ))
        return entities

    # ── Accessors ──────────────────────────────────────────────────────────────

    @property
    def client(self) -> GraphmindClient:
        return self._client

    @property
    def graph_name(self) -> str:
        return self._graph

    @property
    def project(self) -> str:
        return self._project

    @property
    def tenant(self) -> str:
        return self._tenant

    @property
    def agent_name(self) -> str | None:
        return self._agent_name


# ── Reconstruction Helpers ─────────────────────────────────────────────────────

def _props(node: Any) -> dict:
    if isinstance(node, dict):
        return node.get("properties", node)
    return {}


def _reconstruct_trace(record: list) -> DecisionTrace:
    t, i_node, constraints_raw, a_node = record[0], record[1], record[2], record[3]
    tp, ip, ap = _props(t), _props(i_node), _props(a_node)

    constraints = []
    for cn in (constraints_raw or []):
        cp = _props(cn)
        constraints.append(Constraint(
            id=str(cn.get("id", "") if isinstance(cn, dict) else ""),
            description=str(cp.get("description", "")),
            type=cp.get("type", "blocker"),
            created_at=str(cp.get("createdAt", "")),
        ))

    return DecisionTrace(
        id=str(t.get("id", "") if isinstance(t, dict) else ""),
        intent=Intent(id=str(i_node.get("id", "") if isinstance(i_node, dict) else ""), description=str(ip.get("description", "")), created_at=str(ip.get("createdAt", ""))),
        constraints=constraints,
        action=Action(id=str(a_node.get("id", "") if isinstance(a_node, dict) else ""), description=str(ap.get("description", "")), outcome=ap.get("outcome"), created_at=str(ap.get("createdAt", ""))),
        justification=Justification(
            description=str(tp.get("justification_description", "")),
            confidence=float(tp.get("justification_confidence", 0)),
            ablation_score=float(tp.get("justification_ablationScore")) if tp.get("justification_ablationScore") is not None else None,
        ),
        project="", tenant="",
        status=tp.get("status", "captured"),
        embedding=tp.get("embedding"),
        created_at=str(tp.get("createdAt", "")),
        updated_at=str(tp.get("updatedAt", "")),
    )


def _reconstruct_trace_extended(record: list) -> DecisionTrace:
    base = _reconstruct_trace(record)
    p_node, d_node, ag_node = record[4], record[5], record[6]
    concept_nodes, tool_names = record[7] if len(record) > 7 else None, record[8] if len(record) > 8 else None

    pp, dp, agp = _props(p_node), _props(d_node), _props(ag_node)
    base.project = str(pp.get("name", ""))
    base.tenant = str(pp.get("tenant", ""))
    base.domain = str(dp.get("name")) if dp.get("name") else None
    base.agent = str(agp.get("name")) if agp.get("name") else None

    if concept_nodes:
        base.concepts = [str(_props(cn).get("name", "")) for cn in concept_nodes if _props(cn).get("name")]
    if tool_names:
        base.tool_calls = [ToolCallRecord(name=str(n), args="", created_at="") for n in tool_names if n]

    return base


def _reconstruct_skill(record: list) -> Skill:
    s_node, concepts, domain = record[0], record[1], record[2]
    sp = _props(s_node)
    return Skill(
        id=str(s_node.get("id", "") if isinstance(s_node, dict) else ""),
        name=str(sp.get("name", "")),
        description=str(sp.get("description", "")),
        prompt=str(sp.get("prompt", "")),
        confidence=float(sp.get("confidence", 0)),
        concepts=[str(c) for c in (concepts or []) if c],
        tools=[],
        trace_count=int(sp.get("traceCount", 0)),
        domain=str(domain) if domain else None,
        created_at=str(sp.get("createdAt", "")),
        updated_at=str(sp.get("updatedAt", "")),
    )


def _reconstruct_skill_with_tools(record: list) -> Skill:
    base = _reconstruct_skill(record)
    tools = record[3] if len(record) > 3 else None
    base.tools = [str(t) for t in (tools or []) if t]
    return base
