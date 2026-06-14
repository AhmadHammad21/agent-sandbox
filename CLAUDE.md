# CLAUDE.md

Guidance for Claude Code (and other AI agents) working in this repository.

## What this is

agent-sandbox is open-source infrastructure for running **one persistent,
isolated AI coding agent per tenant**. Each tenant gets a private Daytona
sandbox (their "computer"), a Postgres schema (history + vector memory), and an
S3 prefix (artifacts) — all scoped and isolated. See `README.md` for setup and
`docs/architecture.md` for diagrams.

## Runtime & commands

This project runs on **Bun**, not Node/npm. Bun executes TypeScript directly and
auto-loads `.env`, so there is no build step and no `dotenv`.

```bash
bun install                      # install deps
bun run migrate                  # apply control-plane migrations
bun run provision <id> "Name"    # onboard a tenant (prints its api_key)
bun run dev                      # API server with --watch
bun run example                  # scripted end-to-end demo
bun test                         # deterministic tenant-isolation tests
bun run demo:two-tenants         # two tenants run scripts in their own sandboxes
bun run typecheck                # tsc --noEmit (must stay green)
docker compose -f infra/docker-compose.yml up -d   # Postgres (host :5433) + MinIO
```

Always run `bun run typecheck` before considering a change done.

## Architecture map

| Concern | Where |
|---------|-------|
| Config (env vars) | `src/api/config.ts` — single source of truth; never read `process.env` elsewhere |
| Postgres pool + tenant scoping | `src/api/db.ts` |
| Tenant registry / provisioning | `src/api/tenants/` |
| Daytona sandbox lifecycle | `src/api/sandboxes/manager.ts` |
| S3 artifacts | `src/api/storage/s3.ts` |
| HTTP routes + auth | `src/api/server.ts`, `src/api/auth.ts` |
| Agent loop | `src/agent/runner.ts` |
| LLM client | `src/agent/llm.ts` |
| Tools the agent can call | `src/agent/tools/index.ts` |
| Memory (history + vector recall) | `src/agent/memory.ts`, `src/agent/embeddings.ts` |
| Agent instructions | `src/agent/system_prompt.md` |
| DB schema / migrations | `src/db/schema.sql`, `src/db/migrations/`, `src/db/migrate.ts` |

## Conventions & invariants

- **Imports use explicit `.ts` extensions** (Bun + `allowImportingTsExtensions`).
  Match the existing style; don't drop the extension.
- **Tenant isolation is the core invariant.** Per-tenant DB access MUST go
  through `withTenant(tenantId, ...)` in `src/api/db.ts`, which sets
  `search_path` to `tenant_{id}, public` (public so the `vector` type/operators
  resolve). Control-plane (cross-tenant) data uses
  `control()`. Never interpolate a raw tenant id into SQL — `schemaName()`
  validates it (`^[a-z0-9_]+$`) first.
- **Config only from `src/api/config.ts`.** Add new settings there with sensible
  defaults and document them in `.env.example`.
- **Secrets come from the environment**, never hardcoded.
- **LLM access is via OpenRouter** (OpenAI-compatible API) using the `openai`
  SDK pointed at `OPENROUTER_BASE_URL`. Models are OpenRouter slugs (e.g.
  `anthropic/claude-sonnet-4.6`); switch models via `AGENT_MODEL`, not code.
  OpenRouter is chat-only — **embeddings use a separate provider**
  (`src/agent/embeddings.ts`).
- **Embedding dimension must match the schema.** `agent_memory.embedding` is
  `VECTOR(1536)`. The default `local` embedder is deterministic and dev-only;
  if you swap providers, keep dims aligned (or change the schema).
- **Three model env vars, only one active.** `AGENT_MODEL` drives the tool-use
  loop (`MODELS.agent` in `runner.ts`) — the only one used today. `SUMMARY_MODEL`
  is wired (`MODELS.summary`) but **unreferenced** — a placeholder for future
  conversation summarization into `conversations.summary`. `EMBEDDING_MODEL` is
  only used when `EMBEDDING_PROVIDER=voyage` (off by default).

## Adding things

- **A new agent tool:** add its definition (OpenAI function-tool format) to
  `toolDefinitions` and a `case` in `runTool()` in `src/agent/tools/index.ts`.
  Tools execute against the tenant's Daytona `Sandbox` via `ToolContext`.
- **A new API route:** add it in `src/api/server.ts`, guarded by `requireTenant`
  (tenant-scoped) or `requireAdmin` (control plane).
- **A schema change:** edit `src/db/schema.sql` for the per-tenant tables; for
  control-plane/database-wide changes add a numbered file in `src/db/migrations/`
  (idempotent, `IF NOT EXISTS`). Migrations are applied in lexical order.

## Gotchas

- **Postgres host port is `5433`**, not 5432 — compose remaps it to avoid
  clashing with a native Postgres many machines run on 5432. `localhost:5432`
  silently hits the wrong server (auth-fail or "relation does not exist").
- **Schema name = `tenant_` + tenant id.** So tenant id `tenant_one` lives in
  schema `tenant_tenant_one`. Tenant data is in these schemas, never `public`
  (which only holds `tenants` + `schema_migrations`). To browse: query
  `tenant_<id>.messages` etc., or `SET search_path TO tenant_<id>, public`.
- **Daytona SDK must be modern (>= 0.187).** Old 0.18.x calls a removed
  `/api/workspace` endpoint and 404s against current Daytona Cloud. The `dtn_`
  key is a Daytona Cloud key; `DAYTONA_API_URL` is only for self-host.
- **JS/TS in `run_code`** is written to a temp file and run with `bun` (Daytona's
  `codeRun` only runs the sandbox's default language, Python). The default
  sandbox image has node, bun, npx, python3 — no deno.
- **Inspecting a sandbox:** get `sandbox_id` from `tenant_<id>.sandbox_state`;
  it's named `agent-sandbox-<id>` in the Daytona dashboard. Agent scratch files
  go to `/tmp`.
- **MinIO holds only `.keep` markers** so far — there's no agent tool that writes
  artifacts yet (the `*Artifact` helpers + `GET /artifacts` exist, unused).
- Provisioning a tenant creates a Postgres schema, applies `src/db/schema.sql`, and
  registers the tenant in one transaction; the S3 prefix marker is best-effort.
- The sandbox manager resumes the tenant's existing Daytona sandbox by id from
  `sandbox_state`; it only recreates one if Daytona no longer has it.
- `bun run dev` needs Postgres reachable (`DATABASE_URL`) and, for live agent
  turns, `DAYTONA_API_KEY` and `OPENROUTER_API_KEY`.
