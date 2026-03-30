import re


def sanitize(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_]", "_", value).lower()


def build_graph_namespace(tenant: str) -> str:
    return f"cg_{sanitize(tenant)}"


def sanitize_label(value: str) -> str:
    """Sanitize a label or relationship type for safe use in Cypher."""
    return re.sub(r"[^a-zA-Z0-9_]", "_", value)


def sanitize_property(value: str) -> str:
    """Sanitize a property name for safe use in Cypher."""
    return re.sub(r"[^a-zA-Z0-9_]", "_", value)


def truncate_name(description: str, max_len: int = 60) -> str:
    """Truncate a description into a short name for graph visualization."""
    if not description:
        return "unnamed"
    clean = " ".join(description.split())
    return clean if len(clean) <= max_len else clean[: max_len - 1] + "\u2026"
