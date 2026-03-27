# Dynamic Prompt Injector (The Wrapper)

The Prompt Injector enriches agent prompts with contextual "Director's Commentary" from past decisions.

## How It Works

Implemented as a `dynamicSystemPromptMiddleware`, it runs before every model call:

1. Extracts the last user message from the conversation
2. Queries the Contextual Registry for relevant past context
3. Formats the context into three sections
4. Prepends everything to the system prompt

## Injected Sections

### Relevant Past Logic
Similar past decisions with their reasoning:

```
## Relevant Past Logic (Director's Commentary)
The following past decisions are relevant to the current task.

- **Intent**: Deploy to production (similarity: 0.89)
  **Action taken**: Ran CI pipeline with rollback enabled
  **Why**: Tests passed but staging had intermittent failures
  **Constraints**:
    - [blocker] Staging environment had 3 timeout errors
    - [permission] Deploy approval from team lead required
```

### Established Rules
Patterns validated multiple times and promoted to permanent rules:

```
## Established Rules
These patterns have been validated multiple times and should be followed:

- Always run integration tests before deploy (confidence: 0.95)
- Use retry with exponential backoff for API timeouts (confidence: 0.88)
```

### Anti-Patterns
Approaches that have consistently failed:

```
## Anti-Patterns to Avoid
These approaches have been tried and consistently failed:

- AVOID: Deploying without code review (reason: led to failure)
- AVOID: Ignoring flaky tests in staging (reason: led to failure)
```

## Configuration

The `baseSystemPrompt` config option provides the foundation that context is prepended to. If not set, only the injected context is used as the system prompt.

```typescript
const contextGraph = await createContextGraph({
  // ...
  baseSystemPrompt: "You are a helpful coding assistant.",
});
```
