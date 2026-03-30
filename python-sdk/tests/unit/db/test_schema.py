"""Tests for db/schema.py — bootstrap_schema."""

import logging
from unittest.mock import MagicMock, call

from graphmind_context_graphs.db.schema import bootstrap_schema
from graphmind_context_graphs.db.queries import SCHEMA_QUERIES


class TestBootstrapSchema:
    def test_creates_property_indexes(self):
        client = MagicMock()
        logger = logging.getLogger("test_schema")
        bootstrap_schema(client, "cg_test", 4, "cosine", logger)

        # Should call query for each SCHEMA_QUERIES entry + 3 vector indexes
        expected_calls = len(SCHEMA_QUERIES) + 3
        assert client.query.call_count == expected_calls

    def test_creates_vector_indexes(self):
        client = MagicMock()
        logger = logging.getLogger("test_schema")
        bootstrap_schema(client, "cg_test", 768, "cosine", logger)

        all_calls = [str(c) for c in client.query.call_args_list]
        vector_calls = [c for c in all_calls if "VECTOR INDEX" in c]
        assert len(vector_calls) == 3

    def test_swallows_existing_index_errors(self):
        client = MagicMock()
        client.query.side_effect = Exception("Index already exists")
        logger = logging.getLogger("test_schema")

        # Should not raise
        bootstrap_schema(client, "cg_test", 4, "cosine", logger)

    def test_uses_correct_graph(self):
        client = MagicMock()
        logger = logging.getLogger("test_schema")
        bootstrap_schema(client, "cg_acme", 4, "cosine", logger)

        for c in client.query.call_args_list:
            assert c.kwargs.get("graph") == "cg_acme" or c[1].get("graph") == "cg_acme"
