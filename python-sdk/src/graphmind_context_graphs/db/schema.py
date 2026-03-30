"""Bootstrap schema indexes in Graphmind."""

from __future__ import annotations

import logging
from typing import Any

from .queries import SCHEMA_QUERIES, create_vector_index


def bootstrap_schema(
    client: Any,
    graph: str,
    dimensions: int,
    metric: str,
    logger: logging.Logger,
) -> None:
    logger.info("Bootstrapping schema for graph: %s", graph)

    # Property indexes
    for name, query in SCHEMA_QUERIES.items():
        try:
            client.query(query, graph=graph)
        except Exception as e:
            logger.debug("Index may already exist: %s", e)

    # Vector indexes
    vector_indexes = [
        ("intent_embedding", "Intent"),
        ("trace_embedding", "DecisionTrace"),
        ("concept_embedding", "Concept"),
    ]
    for idx_name, label in vector_indexes:
        try:
            client.query(create_vector_index(idx_name, label, dimensions, metric), graph=graph)
        except Exception as e:
            logger.debug("Vector index may already exist: %s", e)

    logger.info("Schema bootstrap complete")
