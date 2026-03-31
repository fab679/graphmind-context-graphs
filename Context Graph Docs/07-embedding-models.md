# Embedding Models

Graphmind Context Graphs supports **any LangChain-compatible embedding model** with automatic dimension detection. Use OpenAI, Azure, AWS Bedrock, Google, Cohere, Ollama, or any other provider.

## Quick Start

### TypeScript

```typescript
import { OpenAIEmbeddings } from "@langchain/openai";
import { createContextGraph, LangChainEmbeddingAdapter } from "graphmind-context-graphs";

// 1. Create any LangChain embeddings
const langchainEmbeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-large"
});

// 2. Wrap with the adapter — dimensions auto-detected!
const provider = new LangChainEmbeddingAdapter(langchainEmbeddings);

// 3. Pre-detect dimensions before creating context graph (optional but recommended)
await provider.detectDimensions();

// 4. Create context graph
const cg = await createContextGraph({
  tenant: "my_tenant",
  project: "my_project",
  embedding: { provider, dimensions: provider.dimensions },
});
```

### Python

```python
from langchain_openai import OpenAIEmbeddings
from graphmind_context_graphs import (
    create_context_graph,
    ContextGraphConfig,
    EmbeddingConfig,
    LangChainEmbeddingAdapter,
)

# 1. Create any LangChain embeddings
langchain_embeddings = OpenAIEmbeddings(model="text-embedding-3-large")

# 2. Wrap with the adapter — dimensions auto-detected!
provider = LangChainEmbeddingAdapter(langchain_embeddings)

# 3. Pre-detect dimensions before creating context graph (optional but recommended)
await provider.detect_dimensions()

# 4. Create context graph
cg = create_context_graph(ContextGraphConfig(
    tenant="my_tenant",
    project="my_project",
    embedding=EmbeddingConfig(provider=provider, dimensions=provider.dimensions),
))
```

## Supported Providers

### OpenAI

```typescript
import { OpenAIEmbeddings } from "@langchain/openai";

const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-large"  // 3072 dimensions
  // or "text-embedding-3-small"   // 1536 dimensions
  // or "text-embedding-ada-002"   // 1536 dimensions
});
```

```python
from langchain_openai import OpenAIEmbeddings

embeddings = OpenAIEmbeddings(
    model="text-embedding-3-large"  # 3072 dimensions
)
```

### Azure OpenAI

```typescript
import { AzureOpenAIEmbeddings } from "@langchain/openai";

const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiEmbeddingsDeploymentName: "text-embedding-ada-002"
});
```

```python
from langchain_openai import AzureOpenAIEmbeddings

embeddings = AzureOpenAIEmbeddings(
    azure_openai_api_embeddings_deployment_name="text-embedding-ada-002"
)
```

### AWS Bedrock

```typescript
import { BedrockEmbeddings } from "@langchain/aws";

const embeddings = new BedrockEmbeddings({
  model: "amazon.titan-embed-text-v1"  // 1536 dimensions
  // or "amazon.titan-embed-text-v2"   // 1024 dimensions
});
```

```python
from langchain_aws import BedrockEmbeddings

embeddings = BedrockEmbeddings(
    model_id="amazon.titan-embed-text-v1"  # 1536 dimensions
)
```

### Google Gemini

```typescript
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";

const embeddings = new GoogleGenerativeAIEmbeddings({
  model: "text-embedding-004"  // 768 dimensions
});
```

```python
from langchain_google_genai import GoogleGenerativeAIEmbeddings

embeddings = GoogleGenerativeAIEmbeddings(
    model="text-embedding-004"  # 768 dimensions
)
```

### Google Vertex AI

```typescript
import { VertexAIEmbeddings } from "@langchain/google-vertexai";

const embeddings = new VertexAIEmbeddings({
  model: "gemini-embedding-001"  // 768 dimensions
});
```

```python
from langchain_google_vertexai import VertexAIEmbeddings

embeddings = VertexAIEmbeddings(
    model="gemini-embedding-001"  # 768 dimensions
)
```

### MistralAI

```typescript
import { MistralAIEmbeddings } from "@langchain/mistralai";

const embeddings = new MistralAIEmbeddings({
  model: "mistral-embed"  // 1024 dimensions
});
```

```python
from langchain_mistralai import MistralAIEmbeddings

embeddings = MistralAIEmbeddings(
    model="mistral-embed"  # 1024 dimensions
)
```

### Cohere

```typescript
import { CohereEmbeddings } from "@langchain/cohere";

const embeddings = new CohereEmbeddings({
  model: "embed-english-v3.0"  // 1024 dimensions
  // or "embed-english-light-v3.0"    // 384 dimensions
  // or "embed-multilingual-v3.0"     // 1024 dimensions
});
```

```python
from langchain_cohere import CohereEmbeddings

embeddings = CohereEmbeddings(
    model="embed-english-v3.0"  # 1024 dimensions
)
```

### Ollama (Local)

```typescript
import { OllamaEmbeddings } from "@langchain/ollama";

const embeddings = new OllamaEmbeddings({
  model: "nomic-embed-text",  // 768 dimensions
  baseUrl: "http://localhost:11434"
});
```

```python
from langchain_ollama import OllamaEmbeddings

embeddings = OllamaEmbeddings(
    model="nomic-embed-text",  # 768 dimensions
    base_url="http://localhost:11434"
)
```

## How Auto-Detection Works

The `LangChainEmbeddingAdapter` automatically detects embedding dimensions by:

1. **First call to `embed()` or `embed_batch()`** — Makes a test embedding and measures the output length
2. **Caching the result** — Subsequent calls use the cached dimension
3. **Optional pre-detection** — Call `detectDimensions()` before creating the ContextGraph to avoid runtime detection

```typescript
// Auto-detection happens on first use
const provider = new LangChainEmbeddingAdapter(embeddings);

// Option 1: Let it auto-detect on first embed() call
const cg = await createContextGraph({
  embedding: { provider, dimensions: 0 }  // Will be updated after first call
});

// Option 2: Pre-detect dimensions (recommended)
const dimensions = await provider.detectDimensions();
const cg = await createContextGraph({
  embedding: { provider, dimensions }
});
```

## Known Embedding Dimensions

The SDK includes a lookup table for popular models to help with configuration:

```typescript
import { KNOWN_EMBEDDING_DIMENSIONS, getKnownEmbeddingDimensions } from "graphmind-context-graphs";

// Lookup known dimensions
const dims = getKnownEmbeddingDimensions("text-embedding-3-large");  // 3072

// Or use the full table
console.log(KNOWN_EMBEDDING_DIMENSIONS["mistral-embed"]);  // 1024
```

```python
from graphmind_context_graphs import KNOWN_EMBEDDING_DIMENSIONS, get_known_embedding_dimensions

# Lookup known dimensions
dims = get_known_embedding_dimensions("text-embedding-3-large")  # 3072

# Or use the full table
print(KNOWN_EMBEDDING_DIMENSIONS["mistral-embed"])  # 1024
```

### Supported Models Reference

| Provider | Model | Dimensions |
|----------|-------|------------|
| OpenAI | text-embedding-3-small | 1536 |
| OpenAI | text-embedding-3-large | 3072 |
| OpenAI | text-embedding-ada-002 | 1536 |
| AWS Bedrock | amazon.titan-embed-text-v1 | 1536 |
| AWS Bedrock | amazon.titan-embed-text-v2 | 1024 |
| Google | text-embedding-004 | 768 |
| Google | gemini-embedding-001 | 768 |
| MistralAI | mistral-embed | 1024 |
| Cohere | embed-english-v3.0 | 1024 |
| Cohere | embed-english-light-v3.0 | 384 |
| Cohere | embed-multilingual-v3.0 | 1024 |
| Ollama | nomic-embed-text | 768 |
| Ollama | mxbai-embed-large | 1024 |
| Ollama | all-minilm | 384 |
| Ollama | llama2 | 4096 |
| Ollama | llama3 | 4096 |
| Ollama | mistral | 4096 |

## Custom Embeddings

You can use any embedding model that implements the LangChain `Embeddings` interface:

```typescript
// Any class with embedQuery() and embedDocuments() methods
class MyCustomEmbeddings {
  async embedQuery(text: string): Promise<number[]> {
    // Your embedding logic
    return [0.1, 0.2, 0.3, ...];  // Return vector
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    // Your batch embedding logic
    return texts.map(() => [0.1, 0.2, 0.3, ...]);
  }
}

const provider = new LangChainEmbeddingAdapter(new MyCustomEmbeddings());
```

## Environment Variables

Each provider has its own environment variable requirements:

| Provider | Variables |
|----------|-----------|
| OpenAI | `OPENAI_API_KEY` |
| Azure OpenAI | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_API_INSTANCE_NAME` |
| AWS Bedrock | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION` |
| Google | `GOOGLE_API_KEY` or `GOOGLE_APPLICATION_CREDENTIALS` |
| MistralAI | `MISTRAL_API_KEY` |
| Cohere | `COHERE_API_KEY` |
| Ollama | (local, no key needed) |

## Complete Example

```typescript
import { OpenAIEmbeddings } from "@langchain/openai";
import { createContextGraph, LangChainEmbeddingAdapter } from "graphmind-context-graphs";

// Initialize embedding model
const embeddings = new OpenAIEmbeddings({
  model: "text-embedding-3-large"
});

// Wrap with adapter
const provider = new LangChainEmbeddingAdapter(embeddings);

// Pre-detect dimensions
const dimensions = await provider.detectDimensions();
console.log(`Detected ${dimensions} dimensions`);  // 3072

// Create context graph
const cg = await createContextGraph({
  tenant: "my_company",
  project: "production",
  embedding: { provider, dimensions },
});

// Use the agent — embeddings are handled automatically
const agent = createAgent({
  model: "openai:gpt-4.1",
  tools: cg.tools,
  middleware: cg.middleware,
});
```
