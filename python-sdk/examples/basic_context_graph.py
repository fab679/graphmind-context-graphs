"""
Basic Context Graph — Decision Trace Capture & Replay (Python)

Usage:
    pip install graphmind-context-graphs langchain-openai
    python examples/basic_context_graph.py

Prerequisites:
    - Graphmind running: docker run -d -p 8080:8080 fabischk/graphmind:latest
    - GRAPHMIND_URL, OPENAI_API_KEY in .env
"""

from langchain.agents import create_agent
from langchain.tools import tool
from langchain_openai import OpenAIEmbeddings

from graphmind_context_graphs import (
    create_context_graph,
    ContextGraphConfig,
    EmbeddingConfig,
)


# ── Embedding Provider ─────────────────────────────────────────────────────────

class OpenAIEmbeddingProvider:
    def __init__(self, model: str = "text-embedding-3-small", dims: int = 1536):
        self._embeddings = OpenAIEmbeddings(model=model)
        self._dimensions = dims

    @property
    def dimensions(self) -> int:
        return self._dimensions

    def embed(self, text: str) -> list[float]:
        return self._embeddings.embed_query(text)

    def embed_batch(self, texts: list[str]) -> list[list[float]]:
        return self._embeddings.embed_documents(texts)


# ── Tools ──────────────────────────────────────────────────────────────────────

@tool
def search_knowledge_base(query: str) -> str:
    """Search the support knowledge base for help articles."""
    articles = {
        "password": "To reset: Settings > Security > Reset Password. Links expire in 24h.",
        "account": "Account locked after 5 failed attempts. Wait 30 min or contact support.",
        "api": "Rate limits: Free=100/min, Pro=1000/min. Use exponential backoff.",
    }
    key = next((k for k in articles if k in query.lower()), None)
    return articles[key] if key else f"No articles found for '{query}'."


@tool
def check_account_status(email: str) -> str:
    """Look up a customer account by email."""
    accounts = {
        "bob@example.com": '{"name": "Bob", "plan": "Free", "status": "locked", "failedAttempts": 5}',
    }
    return accounts.get(email, f"No account found for {email}")


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    print("Context Graph — Basic Python Demo\n")

    embedding = OpenAIEmbeddingProvider()

    cg = create_context_graph(ContextGraphConfig(
        tenant="demo",
        project="helpdesk",
        agent="support-agent",
        embedding=EmbeddingConfig(provider=embedding, dimensions=1536),
        observer_model="openai:gpt-4.1-mini",
        base_system_prompt="You are a helpful customer support agent. Use tools to look up information.",
    ))

    print(f"Context Graph initialized. Graph: {cg.store.graph_name}")
    stats = cg.lifecycle.get_lifecycle_stats()
    print(f"  Existing traces: {stats.total}")

    agent = create_agent(
        "openai:gpt-4.1",
        tools=[search_knowledge_base, check_account_status, *cg.tools],
        middleware=cg.middleware,
    )

    # First conversation
    print("\n--- Conversation 1: Locked Account ---")
    result = agent.invoke({
        "messages": [{"role": "user", "content": "I can't log in. My email is bob@example.com and my account is locked."}],
    })
    for msg in result["messages"]:
        role = getattr(msg, "type", "unknown")
        content = getattr(msg, "content", "")
        if role == "ai" and content:
            print(f"[Agent] {content[:200]}")

    # Second conversation (context should be injected)
    print("\n--- Conversation 2: Similar Issue ---")
    result = agent.invoke({
        "messages": [{"role": "user", "content": "My account seems locked. I keep getting errors when signing in."}],
    })
    for msg in result["messages"]:
        role = getattr(msg, "type", "unknown")
        content = getattr(msg, "content", "")
        if role == "ai" and content:
            print(f"[Agent] {content[:200]}")

    # Stats
    print("\n--- Statistics ---")
    stats = cg.lifecycle.get_lifecycle_stats()
    print(f"Traces: {stats.total} (captured: {stats.captured})")

    concepts = cg.store.get_concepts_by_project()
    if concepts:
        print("Concepts:", ", ".join(f"#{c['name']}" for c in concepts))

    tool_stats = cg.store.get_tool_stats()
    if tool_stats:
        print("Tools:", ", ".join(f"{t['tool_name']}({t['call_count']})" for t in tool_stats))


if __name__ == "__main__":
    main()
