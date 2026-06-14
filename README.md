# agent-sandbox

> Isolated, stateful AI agents for every tenant — open-source multi-tenant agent infrastructure.

Each tenant gets a persistent, isolated AI coding agent that remembers state
between sessions: filesystem, memory, conversation history, and artifacts — all
scoped per tenant.

See [docs/architecture.md](./docs/architecture.md) for diagrams (system overview,
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
src/
  api/        Backend API (config, db, auth, server)
    tenants/    Tenant registry + provisioning
    agents/     Agent session orchestration
    sandboxes/  Daytona sandbox lifecycle
    storage/    S3 artifact storage
  agent/      Agent logic (runner, tools, memory, embeddings, system prompt)
  db/         schema.sql, migrations, migrate runner
  examples/   End-to-end integration examples
tests/      Automated tests (bun test) + demos
infra/      docker-compose (Postgres + MinIO), Daytona notes
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

# 4. Set DAYTONA_API_KEY in .env (Daytona Cloud needs only the key;
#    self-hosters also set DAYTONA_API_URL — see infra/daytona/README.md)

# 5. Apply control-plane migrations (pgvector extension + tenant registry)
bun run migrate

# 6. Provision your first tenant
bun run provision acme "Acme Inc"
#    → prints the tenant's api_key

# 7. Run the API
bun run dev
```

Verify isolation and the end-to-end flow:

```bash
bun test                  # deterministic tenant-isolation tests
bun run demo:two-tenants  # two tenants each run a script in their own sandbox
```

Then drive it over HTTP — see [src/examples/README.md](./src/examples/README.md) — or run
the scripted end-to-end demo:

```bash
bun run example
```

## How a session works

```
POST /session  (Bearer <tenant api_key>)
  → resume (or create) the tenant's Daytona sandbox
  → load recent conversation history (+ semantic memory if embeddings are on)
  → run the agent tool-use loop (AGENT_MODEL) inside the sandbox
  → persist new messages + any remembered facts to the tenant's schema
  → return the reply
```

## Configuration

All config is via environment variables (Bun auto-loads `.env`). See
[`.env.example`](./.env.example) for the full list.

### The three models

| Var | Status | Role |
|-----|--------|------|
| `AGENT_MODEL` | **active** | Runs the per-turn tool-use loop — decides which tools to call and writes the reply. The only model doing work today. Default `anthropic/claude-haiku-4.5` (cheap; swap for `anthropic/claude-sonnet-4.6`, `openai/gpt-4.1`, `google/gemini-2.5-pro`, etc. — any OpenRouter slug, no code change). |
| `SUMMARY_MODEL` | wired, **not used yet** | Intended to cheaply compress old conversation history into `conversations.summary` so long histories don't blow the context window. Placeholder until summarization is implemented. |
| `EMBEDDING_MODEL` | **dormant** (embeddings off) | Turns text into vectors for `agent_memory` semantic recall. Only used when `EMBEDDING_PROVIDER=voyage`. |

`AGENT_MODEL` and `SUMMARY_MODEL` go through OpenRouter (one API key, many
models). Embeddings are a separate provider because OpenRouter is chat-only.

### Embeddings

- `EMBEDDING_PROVIDER` — `none` (default, semantic recall disabled),
  `local` (dependency-free dev-only hashing), or `voyage`.
- The `agent_memory.embedding` column is `VECTOR(1536)`; if you switch providers,
  match the dimension. See [`src/agent/embeddings.ts`](./src/agent/embeddings.ts).
- With embeddings off, the `remember` tool still **stores** facts (with a NULL
  embedding) — they just aren't semantically recalled until you turn it on.

## Inspecting local state

- **Postgres (DBeaver / psql):** the compose file maps Postgres to host port
  **`5433`** (to avoid clashing with a native Postgres on 5432). Connect to
  `localhost:5433`, db `agent_sandbox`, `postgres`/`postgres`. Tenant data lives
  in per-tenant **schemas**, not `public` — and the schema name is
  `tenant_` + the tenant id, so tenant `acme` → schema `tenant_acme`, tenant
  `tenant_one` → schema `tenant_tenant_one`:
  ```sql
  SELECT role, content FROM tenant_acme.messages ORDER BY created_at;
  SELECT sandbox_id, status FROM tenant_acme.sandbox_state;
  SELECT id, name FROM public.tenants;   -- registry only
  ```
- **A tenant's sandbox:** grab its `sandbox_id` from `tenant_<id>.sandbox_state`,
  then open it in the Daytona dashboard (named `agent-sandbox-<id>`) or drive it
  via the SDK. The agent writes scratch files to `/tmp` by default.
- **MinIO:** console at <http://localhost:9001> (`minioadmin`/`minioadmin`), or
  ```bash
  docker run --rm --network infra_default --entrypoint /bin/sh minio/mc -c \
    "mc alias set local http://minio:9000 minioadmin minioadmin && mc ls -r local/agent-sandbox"
  ```

## Status

Built and working: tenant provisioning, schema-per-tenant isolation (verified by
`tests/`), Daytona sandbox lifecycle, the agent tool-use loop, conversation
persistence, and the S3 layer.

Not built yet:
- **Frontend / webhook interface.**
- **S3 artifact tool** — `put/get/listArtifacts` and `GET /artifacts` exist, but
  the agent has no tool to write artifacts, so only `.keep` markers are stored.
- **Conversation summarization** (`SUMMARY_MODEL` / `conversations.summary`).
- **Semantic memory** is off by default (`EMBEDDING_PROVIDER=none`).

## Notes

- Secrets are never hardcoded — everything is read from the environment.
- The `local` embedding backend is a deterministic hashing embedder (dev-only);
  use `voyage` (or any 1536-dim provider) before relying on recall quality.

## License

AGPL-3.0.
