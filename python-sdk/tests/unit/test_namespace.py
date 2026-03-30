"""Tests for utils/namespace.py."""

from graphmind_context_graphs.utils.namespace import (
    sanitize, build_graph_namespace, sanitize_label, sanitize_property, truncate_name,
)


class TestSanitize:
    def test_basic(self):
        assert sanitize("hello") == "hello"

    def test_uppercase_to_lower(self):
        assert sanitize("Hello") == "hello"

    def test_replaces_special_chars(self):
        assert sanitize("my-tenant!@#") == "my_tenant___"

    def test_spaces_replaced(self):
        assert sanitize("my tenant") == "my_tenant"

    def test_preserves_underscores(self):
        assert sanitize("my_tenant") == "my_tenant"


class TestBuildGraphNamespace:
    def test_basic(self):
        assert build_graph_namespace("acme") == "cg_acme"

    def test_sanitizes(self):
        assert build_graph_namespace("Acme Corp!") == "cg_acme_corp_"


class TestSanitizeLabel:
    def test_preserves_pascal_case(self):
        assert sanitize_label("CodeFile") == "CodeFile"

    def test_replaces_special(self):
        assert sanitize_label("my-label!") == "my_label_"

    def test_preserves_underscores(self):
        assert sanitize_label("UPPER_SNAKE") == "UPPER_SNAKE"


class TestSanitizeProperty:
    def test_basic(self):
        assert sanitize_property("createdAt") == "createdAt"

    def test_special_chars(self):
        assert sanitize_property("my-prop.name") == "my_prop_name"


class TestTruncateName:
    def test_short_string(self):
        assert truncate_name("hello") == "hello"

    def test_empty(self):
        assert truncate_name("") == "unnamed"

    def test_long_string(self):
        result = truncate_name("a" * 100, max_len=60)
        assert len(result) == 60
        assert result.endswith("\u2026")

    def test_whitespace_collapse(self):
        assert truncate_name("  hello   world  ") == "hello world"

    def test_exact_boundary(self):
        s = "a" * 60
        assert truncate_name(s, max_len=60) == s
