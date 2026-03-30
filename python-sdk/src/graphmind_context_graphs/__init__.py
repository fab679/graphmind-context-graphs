"""Graphmind Context Graphs — Director's Commentary middleware for AI agents."""

from __future__ import annotations

import os
from dataclasses import dataclass

from dotenv import load_dotenv

from .types.config import ContextGraphConfig, ResolvedContextGraphConfig, GraphmindConnectionConfig, EmbeddingConfig
from .types.data_model import *  # noqa: F401, F403
from .types.lifecycle import *  # noqa: F401, F403
from .db.client import GraphmindStore
from .core.contextual_registry import ContextualRegistry
from .core.knowledge_lifecycle import KnowledgeLifecycleManager
from .core.prompt_injector import create_prompt_injector
from .core.reasoning_extractor import ReasoningExtractorMiddleware
from .core.schema_inspector import create_schema_inspector_tool, create_graph_query_tool, format_schema_for_prompt
from .core.entity_builder import create_entity_tool, create_relationship_tool, create_find_entities_tool
from .core.skill_tool import create_skill_tool, create_list_skills_tool, format_skill_as_markdown
from .embeddings.provider import EmbeddingProvider


@dataclass
class ContextGraphInstance:
    """The result of create_context_graph()."""
    middleware: list
    tools: list
    registry: ContextualRegistry
    lifecycle: KnowledgeLifecycleManager
    store: GraphmindStore


def create_context_graph(config: ContextGraphConfig) -> ContextGraphInstance:
    """Create a Context Graph instance — the main entry point.

    Returns middleware (for LangChain agent), tools (for brain-mapping),
    and lifecycle manager (for knowledge curation).

    ```python
    from graphmind_context_graphs import create_context_graph
    from langchain.agents import create_agent

    cg = create_context_graph(ContextGraphConfig(
        tenant="my_company",
        project="support",
        agent="support-agent",
        embedding=EmbeddingConfig(provider=my_embedding, dimensions=1536),
    ))

    agent = create_agent(
        "openai:gpt-4.1",
        tools=[...my_tools, *cg.tools],
        middleware=cg.middleware,
    )
    ```
    """
    resolved = _resolve_config(config)

    store = GraphmindStore(resolved)
    store.initialize()

    observer_model = None
    if resolved.observer_model:
        from langchain.chat_models import init_chat_model
        observer_model = init_chat_model(resolved.observer_model)

    registry = ContextualRegistry(store, resolved.embedding.provider, resolved)
    lifecycle = KnowledgeLifecycleManager(store, resolved)

    prompt_injector = create_prompt_injector(registry, resolved)
    reasoning_extractor = ReasoningExtractorMiddleware(resolved, registry, observer_model)

    tools = [
        create_schema_inspector_tool(store),
        create_graph_query_tool(store),
        create_entity_tool(store),
        create_relationship_tool(store),
        create_find_entities_tool(store),
    ]

    return ContextGraphInstance(
        middleware=[prompt_injector, reasoning_extractor],
        tools=tools,
        registry=registry,
        lifecycle=lifecycle,
        store=store,
    )


def _resolve_config(config: ContextGraphConfig) -> ResolvedContextGraphConfig:
    load_dotenv()

    gm = config.graphmind or GraphmindConnectionConfig()
    resolved_gm = GraphmindConnectionConfig(
        url=gm.url or os.environ.get("GRAPHMIND_URL", "http://localhost:8080"),
        token=gm.token or os.environ.get("GRAPHMIND_TOKEN"),
        username=gm.username or os.environ.get("GRAPHMIND_USERNAME"),
        password=gm.password or os.environ.get("GRAPHMIND_PASSWORD"),
    )

    return ResolvedContextGraphConfig(
        tenant=config.tenant,
        project=config.project,
        embedding=config.embedding,
        graphmind=resolved_gm,
        domain=config.domain,
        agent=config.agent,
        agent_description=config.agent_description,
        context_sharing=config.context_sharing,
        allowed_agents=config.allowed_agents,
        observer_model=config.observer_model,
        vector_search_limit=config.vector_search_limit,
        similarity_threshold=config.similarity_threshold,
        base_system_prompt=config.base_system_prompt,
        debug=config.debug,
    )
