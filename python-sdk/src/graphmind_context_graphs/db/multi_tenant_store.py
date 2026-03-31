"""Multi-tenant store manager for dynamic tenant creation from runtime context."""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from .client import GraphmindStore
from ..utils.namespace import build_graph_namespace
from ..utils.logger import create_logger

if TYPE_CHECKING:
    from ..types.config import ResolvedContextGraphConfig
    from ..embeddings.provider import EmbeddingProvider


@dataclass
class RuntimeTenantContext:
    """Runtime tenant context passed via middleware."""

    tenant: str | None = None
    project: str | None = None
    agent: str | None = None
    agent_description: str | None = None
    embedding: EmbeddingProvider | None = None


class MultiTenantGraphmindStore:
    """Multi-tenant store manager that lazily creates tenant-specific stores.

    This enables runtime context to specify different tenants, and the system
    will automatically create/initialize the appropriate context graph.
    """

    def __init__(
        self,
        config: ResolvedContextGraphConfig,
        embedding_provider: EmbeddingProvider,
    ) -> None:
        self._config = config
        self._stores: dict[str, GraphmindStore] = {}
        self._embedding_provider = embedding_provider
        self._logger = create_logger(config.debug)

    def get_store_for_runtime(
        self,
        runtime_context: RuntimeTenantContext | None = None,
    ) -> GraphmindStore:
        """Get or create a store for the specified runtime context.

        If runtime tenant differs from base config, creates a new store dynamically.
        """
        effective_tenant = runtime_context.tenant if runtime_context and runtime_context.tenant else self._config.tenant
        effective_project = runtime_context.project if runtime_context and runtime_context.project else self._config.project
        effective_agent = runtime_context.agent if runtime_context and runtime_context.agent else self._config.agent
        effective_agent_description = (
            runtime_context.agent_description
            if runtime_context and runtime_context.agent_description
            else self._config.agent_description
        )

        # Use base store if tenant matches the original config
        if not runtime_context or not runtime_context.tenant or runtime_context.tenant == self._config.tenant:
            if self._config.tenant not in self._stores:
                store = GraphmindStore(self._config)
                store.initialize()
                self._stores[self._config.tenant] = store
                self._logger.info("Initialized base store for tenant: %s", self._config.tenant)
            return self._stores[self._config.tenant]

        # Check if we already have a store for this runtime tenant
        store_key = f"{effective_tenant}:{effective_project}:{effective_agent or 'default'}"
        if store_key in self._stores:
            return self._stores[store_key]

        # Create new store configuration for runtime tenant
        from ..types.config import ResolvedContextGraphConfig

        runtime_config = ResolvedContextGraphConfig(
            tenant=effective_tenant,
            project=effective_project,
            agent=effective_agent,
            agent_description=effective_agent_description,
            embedding=runtime_context.embedding if runtime_context and runtime_context.embedding else self._config.embedding,
            graphmind=self._config.graphmind,
            domain=self._config.domain,
            context_sharing=self._config.context_sharing,
            allowed_agents=self._config.allowed_agents,
            observer_model=self._config.observer_model,
            vector_search_limit=self._config.vector_search_limit,
            similarity_threshold=self._config.similarity_threshold,
            base_system_prompt=self._config.base_system_prompt,
            debug=self._config.debug,
        )

        # Create and initialize the new store
        self._logger.info(
            "Creating new context graph for runtime tenant: %s, project: %s, agent: %s",
            effective_tenant,
            effective_project,
            effective_agent or "default",
        )

        store = GraphmindStore(runtime_config)
        store.initialize()
        self._stores[store_key] = store

        self._logger.info(
            "Successfully initialized context graph: %s",
            build_graph_namespace(effective_tenant),
        )

        return store

    def get_base_store(self) -> GraphmindStore:
        """Get the base store (original tenant from config)."""
        return self._stores.get(self._config.tenant)

    def get_all_stores(self) -> list[GraphmindStore]:
        """Get all active stores."""
        return list(self._stores.values())

    def clear(self) -> None:
        """Clear all cached stores (useful for testing or reset)."""
        self._stores.clear()
