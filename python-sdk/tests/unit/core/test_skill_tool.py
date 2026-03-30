"""Tests for core/skill_tool.py — format_skill_as_markdown."""

from graphmind_context_graphs.core.skill_tool import format_skill_as_markdown
from graphmind_context_graphs.types.data_model import Skill


class TestFormatSkillAsMarkdown:
    def test_basic(self, sample_skill):
        md = format_skill_as_markdown(sample_skill)
        assert "handle-auth-issues" in md
        assert "Diagnose and fix authentication problems" in md
        assert "search_code, check_logs" in md
        assert "tech" in md
        assert "0.85" in md
        assert "#authentication" in md
        assert "#tokens" in md

    def test_minimal_skill(self):
        skill = Skill(
            name="basic", description="A basic skill", prompt="Do the thing",
            confidence=0.5, concepts=[], tools=[], trace_count=1,
            created_at="now", updated_at="now",
        )
        md = format_skill_as_markdown(skill)
        assert "basic" in md
        assert "Do the thing" in md
        assert "allowed-tools" not in md  # no tools
        assert "Tags" not in md  # no concepts

    def test_has_frontmatter(self, sample_skill):
        md = format_skill_as_markdown(sample_skill)
        assert md.startswith("---")
        assert md.count("---") >= 2
