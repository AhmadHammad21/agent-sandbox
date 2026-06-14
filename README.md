# agent-sandbox

> Isolated, stateful AI agents for every tenant — open-source multi-tenant agent infrastructure.

Each tenant gets a persistent, isolated AI coding agent that remembers state
between sessions: filesystem, memory, conversation history, and artifacts — all
scoped per tenant.

See [PLAN.md](./PLAN.md) for the full design and
[docs/architecture.md](./docs/architecture.md) for diagrams (system overview,
isolation model, per-session flow, sandbox lifecycle).

## Architecture

| Layer          | Component                                            |
|----------------|-----------------------------------------------------|
| Sandbox        | [Daytona](https://www.daytona.io/) — one persistent sandbox per tenant |
| State / memory | Postgres + pgvector — one schema per tenant          |
| Artifacts      | S3-compatible storage — one prefix per tenant        |
| API            | TypeScript + Express, run with [Bun](https://bun.sh) |
| Agent          | [OpenRouter](https://openrouter.ai) — one API for many models (cheap default `anthropic/claude-haiku-4.5`) |

Isolation model:
- **Postgres:** schema-per-tenant (`tenant_{id}`); every query sets `search_path`.
- **Daytona:** one sandbox per tenant, labelled `tenant_id`, id stored in `sandbox_state` so sessions resume.
- **S3:** one prefix per tenant (`tenant-{id}/`).

## Project layout

```
api/        Backend API (config, db, auth, server)
  tenants/    Tenant registry + provisioning
  agents/     Agent session orchestration
  sandboxes/  Daytona sandbox lifecycle
  storage/    S3 artifact storage
agent/      Agent logic (runner, tools, memory, embeddings, system prompt)
db/         schema.sql, migrations, migrate runner
infra/      docker-compose (Postgres + MinIO), Daytona notes
examples/   End-to-end integration examples
```

## Quick start

Prerequisites: [Bun](https://bun.sh), Docker, and an `OPENROUTER_API_KEY`.

```bash
# 1. Install dependencies
bun install

# 2. Configure
cp .env.example .env   # then fill in OPENROUTER_API_KEY etc.

# 3. Start Postgres + MinIO
docker compose -f infra/docker-compose.yml up -d

# 4. Set up Daytona (see infra/daytona/README.md) and set DAYTONA_* in .env

# 5. Apply control-plane migrations (pgvector extension + tenant registry)
bun run migrate

# 6. Provision your first tenant
bun run provision acme "Acme Inc"
#    → prints the tenant's api_key

# 7. Run the API
bun run dev
```

Then drive it over HTTP — see [examples/README.md](./examples/README.md) — or run
the scripted end-to-end demo:

```bash
bun run example
```

## How a session works

```
POST /session  (Bearer <tenant api_key>)
  → resume (or create) the tenant's Daytona sandbox
  → recall relevant memories (pgvector) + recent conversation history
  → run the Claude tool-use loop inside the sandbox
  → persist new messages + any remembered facts to the tenant's schema
  → return the reply
```

## Configuration

All config is via environment variables (Bun auto-loads `.env`). See
[`.env.example`](./.env.example) for the full list. Notable ones:

- `AGENT_MODEL` — OpenRouter model slug the agent runs with. Defaults to a cheap
  model (`anthropic/claude-haiku-4.5`) to avoid surprise bills; swap in any
  OpenRouter model — e.g. `anthropic/claude-sonnet-4.6`, `openai/gpt-4.1`,
  `google/gemini-2.5-pro` — without code changes.
- `EMBEDDING_PROVIDER` — `local` (default, dependency-free, dev-only) or `voyage`.
  The `agent_memory.embedding` column is `VECTOR(1536)`; if you switch providers,
  match the dimension. See [`agent/embeddings.ts`](./agent/embeddings.ts).

## Notes

- The default `local` embedding backend is a deterministic hashing embedder so
  the scaffold runs with zero extra setup. **Swap in a real provider** (Voyage,
  or any 1536-dim model) before relying on semantic recall quality.
- Secrets are never hardcoded — everything is read from the environment.

## License

AGPL-3.0.
