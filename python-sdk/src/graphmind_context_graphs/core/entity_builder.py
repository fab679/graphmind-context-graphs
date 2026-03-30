"""Dynamic entity builder tools for agent brain mapping."""

from __future__ import annotations

import json
from datetime import datetime, timezone

from langchain.tools import tool
from pydantic import BaseModel, Field, ConfigDict

from ..db.client import GraphmindStore
from ..types.data_model import GraphEntity, GraphRelationship


class CreateEntityInput(BaseModel):
    """Input for create_entity. Extra fields become entity properties."""
    model_config = ConfigDict(extra="allow")

    label: str = Field(description="PascalCase node label (e.g., 'CodeFile', 'APIEndpoint', 'Contract')")
    reason: str | None = Field(default=None, description="Why you are creating this entity")


def create_entity_tool(store: GraphmindStore):
    @tool("create_entity", args_schema=CreateEntityInput)
    def create_entity(**kwargs) -> str:
        """Create a new entity in the context graph to map your understanding of the domain.
        Pass entity properties directly as named arguments (e.g., path, name, decision)."""
        label = kwargs.pop("label")
        reason = kwargs.pop("reason", None)
        now = datetime.now(timezone.utc).isoformat()

        # All remaining kwargs become entity properties
        props: dict[str, str | int | float | bool] = {}
        for k, v in kwargs.items():
            if isinstance(v, (str, int, float, bool)):
                props[k] = v

        if reason:
            props["_reason"] = reason

        try:
            entity_id = store.create_entity(GraphEntity(
                label=label,
                properties=props,
                created_by=store.agent_name,
                created_at=now,
            ))
            return f"Entity created: {label} (id: {entity_id}). Properties: {json.dumps(props)}."
        except Exception as e:
            return f"Failed to create entity: {e}"

    return create_entity


class CreateRelationshipInput(BaseModel):
    source_id: str = Field(description="The node ID of the source entity")
    target_id: str = Field(description="The node ID of the target entity")
    relationship_type: str = Field(description="UPPER_SNAKE_CASE relationship type (e.g., 'IMPORTS', 'DEPENDS_ON')")
    reason: str | None = Field(default=None, description="Why this relationship exists")


def create_relationship_tool(store: GraphmindStore):
    @tool("create_relationship", args_schema=CreateRelationshipInput)
    def create_relationship(source_id: str, target_id: str, relationship_type: str, reason: str | None = None) -> str:
        """Create a relationship between two existing entities in the context graph."""
        now = datetime.now(timezone.utc).isoformat()
        props: dict[str, str | int | float | bool] = {}
        if reason:
            props["_reason"] = reason

        try:
            store.create_relationship(GraphRelationship(
                source_id=source_id,
                target_id=target_id,
                type=relationship_type,
                properties=props,
                created_by=store.agent_name,
                created_at=now,
            ))
            return f"Relationship created: ({source_id})-[:{relationship_type}]->({target_id})."
        except Exception as e:
            return f"Failed to create relationship: {e}"

    return create_relationship


class FindEntitiesInput(BaseModel):
    label: str = Field(description="The entity label to search for (e.g., 'CodeFile')")
    filter: dict[str, str | int | float | bool] | None = Field(default=None, description="Optional property filter")


def create_find_entities_tool(store: GraphmindStore):
    @tool("find_entities", args_schema=FindEntitiesInput)
    def find_entities(label: str, filter: dict | None = None) -> str:
        """Search for existing entities in the context graph by label and optional property filter."""
        try:
            entities = store.find_entities(label, filter)
            if not entities:
                return f"No {label} entities found. Use create_entity to add one."

            items = []
            for e in entities:
                visible_props = {k: v for k, v in e.properties.items() if not str(k).startswith("_")}
                prop_str = ", ".join(f"{k}: {v}" for k, v in visible_props.items())
                items.append(f"- id: {e.id} | {prop_str}")

            return f"Found {len(entities)} {label} entit{'y' if len(entities) == 1 else 'ies'}:\n" + "\n".join(items)
        except Exception as e:
            return f"Search failed: {e}"

    return find_entities
