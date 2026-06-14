# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## What this is

agent-sandbox is open-source infrastructure for running **one persistent,
isolated AI coding agent per tenant**. Each tenant gets a private Daytona
sandbox (their "computer"), a Postgres schema (history + vector memory), and an
S3 prefix (artifacts) — all scoped and isolated. See `PLAN.md` for the full
design and `README.md` for setup.

## Runtime & commands

This project runs on **Bun**, not Node/npm. Bun executes TypeScript directly and
auto-loads `.env`, so there is no build step and no `dotenv`.

```bash
bun install                      # install deps
bun run migrate                  # apply control-plane migrations
bun run provision <id> "Name"    # onboard a tenant (prints its api_key)
bun run dev                      # API server with --watch
bun run example                  # scripted end-to-end demo
bun run typecheck                # tsc --noEmit (must stay green)
docker compose -f infra/docker-compose.yml up -d   # Postgres + MinIO
```

Always run `bun run typecheck` before considering a change done.

## Architecture map

| Concern | Where |
|---------|-------|
| Config (env vars) | `api/config.ts` — single source of truth; never read `process.env` elsewhere |
| Postgres pool + tenant scoping | `api/db.ts` |
| Tenant registry / provisioning | `api/tenants/` |
| Daytona sandbox lifecycle | `api/sandboxes/manager.ts` |
| S3 artifacts | `api/storage/s3.ts` |
| HTTP routes + auth | `api/server.ts`, `api/auth.ts` |
| Agent loop | `agent/runner.ts` |
| LLM client | `agent/llm.ts` |
| Tools the agent can call | `agent/tools/index.ts` |
| Memory (history + vector recall) | `agent/memory.ts`, `agent/embeddings.ts` |
| Agent instructions | `agent/system_prompt.md` |
| DB schema / migrations | `db/schema.sql`, `db/migrations/`, `db/migrate.ts` |

## Conventions & invariants

- **Imports use explicit `.ts` extensions** (Bun + `allowImportingTsExtensions`).
  Match the existing style; don't drop the extension.
- **Tenant isolation is the core invariant.** Per-tenant DB access MUST go
  through `withTenant(tenantId, ...)` in `api/db.ts`, which sets
  `search_path` to `tenant_{id}`. Control-plane (cross-tenant) data uses
  `control()`. Never interpolate a raw tenant id into SQL — `schemaName()`
  validates it (`^[a-z0-9_]+$`) first.
- **Config only from `api/config.ts`.** Add new settings there with sensible
  defaults and document them in `.env.example`.
- **Secrets come from the environment**, never hardcoded.
- **LLM access is via OpenRouter** (OpenAI-compatible API) using the `openai`
  SDK pointed at `OPENROUTER_BASE_URL`. Models are OpenRouter slugs (e.g.
  `anthropic/claude-sonnet-4.6`); switch models via `AGENT_MODEL`, not code.
  OpenRouter is chat-only — **embeddings use a separate provider**
  (`agent/embeddings.ts`).
- **Embedding dimension must match the schema.** `agent_memory.embedding` is
  `VECTOR(1536)`. The default `local` embedder is deterministic and dev-only;
  if you swap providers, keep dims aligned (or change the schema).

## Adding things

- **A new agent tool:** add its definition (OpenAI function-tool format) to
  `toolDefinitions` and a `case` in `runTool()` in `agent/tools/index.ts`.
  Tools execute against the tenant's Daytona `Sandbox` via `ToolContext`.
- **A new API route:** add it in `api/server.ts`, guarded by `requireTenant`
  (tenant-scoped) or `requireAdmin` (control plane).
- **A schema change:** edit `db/schema.sql` for the per-tenant tables; for
  control-plane/database-wide changes add a numbered file in `db/migrations/`
  (idempotent, `IF NOT EXISTS`). Migrations are applied in lexical order.

## Gotchas

- Provisioning a tenant creates a Postgres schema, applies `db/schema.sql`, and
  registers the tenant in one transaction; the S3 prefix marker is best-effort.
- The sandbox manager resumes the tenant's existing Daytona sandbox by id from
  `sandbox_state`; it only recreates one if Daytona no longer has it.
- `bun run dev` needs Postgres reachable (`DATABASE_URL`) and, for live agent
  turns, a Daytona endpoint and `OPENROUTER_API_KEY`.
