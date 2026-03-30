# Deployment Guide

## GitHub Secrets Required

Set these in your repository: **Settings > Secrets and variables > Actions**

### For npm (TypeScript SDK)

| Secret | Where to get it | Used by |
|---|---|---|
| `NPM_TOKEN` | [npmjs.com](https://www.npmjs.com/) > Access Tokens > Generate New Token (Automation) | `publish-npm.yml` |

### For PyPI (Python SDK)

PyPI publishing uses **Trusted Publishers** (no token needed if configured):

1. Go to [pypi.org](https://pypi.org/) > Your Projects > Publishing
2. Add a new "GitHub Actions" trusted publisher:
   - Owner: `your-github-username`
   - Repository: `graphmind-context-graphs`
   - Workflow: `publish-pypi.yml`
   - Environment: (leave blank)

If not using trusted publishers, set:

| Secret | Where to get it | Used by |
|---|---|---|
| `PYPI_API_TOKEN` | [pypi.org](https://pypi.org/) > Account Settings > API tokens | `publish-pypi.yml` |

## How Publishing Works

### Automatic (on release)

1. Create a GitHub Release with a tag like `v0.2.0`
2. Both workflows trigger automatically
3. TypeScript SDK publishes to npm
4. Python SDK publishes to PyPI

### Manual (workflow dispatch)

1. Go to **Actions** tab
2. Select `Publish TypeScript SDK to npm` or `Publish Python SDK to PyPI`
3. Click "Run workflow"
4. Toggle "Dry run" off to actually publish

### CI (on push/PR)

The `ci.yml` workflow runs on every push to `main` and every PR:
- TypeScript: type check + unit tests + build
- Python: unit tests on Python 3.10, 3.11, 3.12

## Version Management

### TypeScript

Version is in `package.json`:
```json
"version": "0.2.0"
```

Bump before publishing:
```bash
npm version patch   # 0.2.0 → 0.2.1
npm version minor   # 0.2.0 → 0.3.0
npm version major   # 0.2.0 → 1.0.0
```

### Python

Version is in `python-sdk/pyproject.toml`:
```toml
version = "0.2.0"
```

Update manually before publishing.

**Keep both versions in sync.**

## Pre-Publish Checklist

```bash
# TypeScript
npm run lint          # Type check
npm test              # Unit tests (156 should pass)
npm run build         # Build dist/

# Python
cd python-sdk
pip install -e ".[dev]"
pytest tests/ -v      # Unit tests
python -m build       # Build dist/
twine check dist/*    # Verify package
```

## Package Names

| Registry | Package Name | Install Command |
|---|---|---|
| npm | `graphmind-context-graphs` | `npm install graphmind-context-graphs` |
| PyPI | `graphmind-context-graphs` | `pip install graphmind-context-graphs` |

## Runtime Environment

Both SDKs need at runtime:

```bash
# Graphmind database
GRAPHMIND_URL=http://your-graphmind:8080

# LLM provider key (at least one)
OPENAI_API_KEY=sk-...

# Optional: observer model for intelligent extraction
MODEL=openai:gpt-4.1-mini
```

The SDKs load `.env` automatically. In production, set these as environment variables directly.
