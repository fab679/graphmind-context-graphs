"""Schema inspection tools for agent brain-map awareness."""

from __future__ import annotations

import json

from langchain.tools import tool
from pydantic import BaseModel, Field

from ..types.data_model import SchemaOverview
from ..db.client import GraphmindStore


def format_schema_for_prompt(schema: SchemaOverview) -> str:
    """Format a SchemaOverview into a section for prompt injection."""
    if not schema.node_labels:
        return ""

    node_lines = "\n".join(f"  - {label} ({schema.node_counts.get(label, 0)} nodes)" for label in schema.node_labels)
    rel_lines = "\n".join(f"  - {t} ({schema.edge_counts.get(t, 0)} edges)" for t in schema.relationship_types)

    return (
        "## Your Brain Map (Context Graph Schema)\n"
        "These are the entity types and relationships you have created or produced.\n"
        "Use this to understand what you already know and build on it coherently.\n\n"
        f"**Entity Types:**\n{node_lines}\n\n"
        f"**Relationship Types:**\n{rel_lines}"
    )


def create_schema_inspector_tool(store: GraphmindStore):
    @tool("inspect_schema")
    def inspect_schema() -> str:
        """Inspect your own context graph schema to see what entity types and relationships you have created.
        Only shows entities and traces you produced. Use before creating new entities to avoid duplicates."""
        schema = store.get_schema_overview()

        if not schema.node_labels:
            return ("The context graph is empty — no entities or relationships exist yet. "
                    "You are in discovery mode. Use `create_entity` and `create_relationship` to build your understanding.")

        sections = ["# Your Context Graph Schema\n", "## Entity Types (Node Labels)"]
        for label in schema.node_labels:
            sections.append(f"- **{label}**: {schema.node_counts.get(label, 0)} node(s)")

        sections.append("\n## Relationship Types")
        for t in schema.relationship_types:
            sections.append(f"- **{t}**: {schema.edge_counts.get(t, 0)} edge(s)")

        sections.append("\n## Guidelines")
        sections.append("- Check if a similar entity type already exists before creating new ones.")
        sections.append("- Entity labels: PascalCase (e.g., `CodeFile`, `APIEndpoint`).")
        sections.append("- Relationship types: UPPER_SNAKE_CASE (e.g., `DEPENDS_ON`, `IMPORTS`).")

        return "\n".join(sections)

    return inspect_schema


class GraphQueryInput(BaseModel):
    query: str = Field(description="A Cypher read query (MATCH...RETURN). No CREATE/DELETE/SET.")
    description: str = Field(description="Brief description of what this query is looking for")


def create_graph_query_tool(store: GraphmindStore):
    @tool("query_graph", args_schema=GraphQueryInput)
    def query_graph(query: str, description: str) -> str:
        """Execute a read-only Cypher query against the context graph to explore entities and relationships."""
        try:
            result = store.client.query_readonly(query, graph=store.graph_name)
            if not result.records:
                return "No results found."

            columns = result.columns or []
            rows = []
            for record in result.records:
                row_parts = []
                for i, col in enumerate(columns):
                    val = record[i] if i < len(record) else None
                    if val is None:
                        row_parts.append(f"{col}: null")
                    elif isinstance(val, dict):
                        row_parts.append(f"{col}: {json.dumps(val)}")
                    else:
                        row_parts.append(f"{col}: {val}")
                rows.append(" | ".join(row_parts))

            return f"Results ({len(result.records)} rows):\n" + "\n".join(rows)
        except Exception as e:
            return f"Query failed: {e}. Ensure correct Cypher syntax and read-only operations."

    return query_graph
