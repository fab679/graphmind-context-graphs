"""Skill tools for progressive disclosure."""

from __future__ import annotations

from langchain.tools import tool
from pydantic import BaseModel, Field

from ..types.data_model import Skill
from ..db.client import GraphmindStore


def format_skill_as_markdown(skill: Skill) -> str:
    lines = ["---", f"name: {skill.name}", f"description: {skill.description}"]
    if skill.tools:
        lines.append(f"allowed-tools: {', '.join(skill.tools)}")
    if skill.domain:
        lines.extend(["metadata:", f"  domain: {skill.domain}", f'  confidence: "{skill.confidence:.2f}"', f'  trace-count: "{skill.trace_count}"'])
    lines.append("---")
    lines.extend(["", f"# {skill.name}", "", "## Overview", "", skill.description, "", "## Instructions", "", skill.prompt])
    if skill.concepts:
        lines.extend(["", "## Tags", "", *(f"- #{c}" for c in skill.concepts)])
    return "\n".join(lines)


class LoadSkillInput(BaseModel):
    skill_name: str = Field(description="Skill name or URL to a SKILL.md file")


def create_skill_tool(store: GraphmindStore):
    @tool("load_skill", args_schema=LoadSkillInput)
    def load_skill(skill_name: str) -> str:
        """Load a specialized skill by name. Use when available skills match the current task."""
        if skill_name.startswith(("http://", "https://")):
            try:
                import urllib.request
                with urllib.request.urlopen(skill_name) as resp:
                    return resp.read().decode()
            except Exception as e:
                return f"Failed to fetch skill from URL: {e}"

        skill = store.get_skill_by_name(skill_name)
        if not skill:
            available = store.get_skills_by_project()
            if not available:
                return "No skills available yet."
            manifest = "\n".join(f"- {s.name}: {s.description} (confidence: {s.confidence:.2f})" for s in available)
            return f'Skill "{skill_name}" not found. Available skills:\n{manifest}'
        return format_skill_as_markdown(skill)

    return load_skill


def create_list_skills_tool(store: GraphmindStore):
    @tool("list_skills")
    def list_skills() -> str:
        """List all available skills that can be loaded for specialized guidance."""
        skills = store.get_skills_by_project()
        if not skills:
            return "No skills available yet."
        items = []
        for s in skills:
            tags = f" [{', '.join(f'#{c}' for c in s.concepts)}]" if s.concepts else ""
            domain = f" ({s.domain})" if s.domain else ""
            items.append(f"- **{s.name}**{domain}: {s.description} — confidence: {s.confidence:.2f}, {s.trace_count} traces{tags}")
        return f"Available skills:\n" + "\n".join(items) + "\n\nUse load_skill to access full skill context."

    return list_skills
