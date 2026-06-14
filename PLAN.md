# agent-sandbox

> Isolated, stateful AI agents for every tenant — open-source multi-tenant agent infrastructure.



## Project Overview

agent-sandbox is an open-source framework for running a persistent, isolated AI coding agent per tenant. Each tenant gets their own sandboxed environment that remembers state between sessions — filesystem, memory, conversation history, and artifacts — all scoped and isolated from other tenants.

Useful for any platform where you want to give each user or organization their own AI agent that persists context over time.

---

## Architecture

### Core Components

1. **Daytona** — sandbox runtime for the coding agent
   - One persistent Daytona sandbox per tenant
   - The sandbox acts as the agent's "computer": it can write and run code, maintain a filesystem, install packages, etc.
   - State persists between sessions (the agent remembers its workspace)
   - Self-hosted (free, AGPL-3.0)

2. **Postgres (any provider)** — structured state and agent memory
   - Single Postgres instance, one schema per tenant (e.g. `tenant_abc`, `tenant_xyz`)
   - Stores: conversation history, agent memory, tenant config, user data
   - Add `pgvector` extension for semantic/vector memory so the agent can recall past context intelligently
   - Use any Postgres: self-hosted, Supabase, RDS, Neon, etc.

3. **S3-compatible object storage** — files and artifacts
   - One prefix per tenant: `s3://bucket/tenant-{id}/`
   - Stores code artifacts, uploaded files, generated outputs, logs

4. **API layer** — coordinates everything
   - On each tenant session:
     1. Look up or create the tenant's Daytona sandbox
     2. Load tenant's memory/history from their Postgres schema
     3. Run the agent inside the sandbox
     4. Save updated memory/state back to Postgres
     5. Save any artifacts to S3

---

## Folder Structure

```
agent-sandbox/
├── api/                    # Backend API (Node.js or Python)
│   ├── tenants/            # Tenant management (create, list, config)
│   ├── agents/             # Agent session orchestration
│   ├── sandboxes/          # Daytona sandbox lifecycle (create, resume, stop)
│   └── memory/             # Postgres read/write for agent memory
├── agent/                  # The coding agent logic
│   ├── system_prompt.md    # Agent instructions
│   ├── tools/              # Tools the agent can use (run_code, read_file, etc.)
│   └── memory.ts           # Memory retrieval and storage helpers
├── db/
│   ├── migrations/         # SQL migrations
│   └── schema.sql          # Base schema (applied per tenant schema)
├── infra/
│   ├── daytona/            # Daytona self-host config
│   └── docker-compose.yml  # Local dev setup
├── examples/               # Example integrations and use cases
└── PLAN.md                 # This file
```

---

## Database Schema (per tenant schema)

```sql
-- Applied once per tenant as: CREATE SCHEMA tenant_{id};
-- Then all tables below live inside that schema

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  summary TEXT
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id),
  role TEXT NOT NULL, -- 'user' | 'assistant' | 'tool'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding VECTOR(1536),  -- pgvector: semantic memory
  created_at TIMESTAMPTZ DEFAULT now(),
  source TEXT              -- e.g. 'conversation', 'file', 'user_note'
);

CREATE TABLE sandbox_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id TEXT NOT NULL,   -- Daytona sandbox ID
  status TEXT NOT NULL,       -- 'running' | 'paused' | 'stopped'
  last_active TIMESTAMPTZ DEFAULT now()
);
```

---

## Tenant Lifecycle

### Onboarding a new tenant
1. Create a new Postgres schema: `CREATE SCHEMA tenant_{id}`
2. Run migrations against that schema
3. Provision a Daytona sandbox and store the sandbox ID in `sandbox_state`
4. Create an S3 prefix: `tenant-{id}/`

### Per-session flow
```
User sends message
  → API identifies tenant
  → Resume (or create) Daytona sandbox for tenant
  → Fetch recent messages + relevant memory from Postgres (vector search)
  → Run agent with context inside sandbox
  → Agent executes code, reads/writes files in sandbox
  → Save new messages + updated memory to Postgres
  → Return response to user
```

### Offboarding / cleanup
- Archive sandbox state
- Export Postgres schema to backup
- Clean up S3 prefix

---

## Key Implementation Tasks

- [x] Set up Daytona self-hosted (`infra/daytona/README.md`)
- [x] Write sandbox manager: create, resume, pause, delete sandboxes via Daytona SDK (`api/sandboxes/manager.ts`)
- [x] Set up Postgres with pgvector extension (`infra/docker-compose.yml`, `db/migrations/0001_control_plane.sql`)
- [x] Write tenant provisioning script (schema creation + migrations) (`api/tenants/provision.ts`, `db/migrate.ts`)
- [x] Build agent memory module: save messages, embed and retrieve via pgvector (`agent/memory.ts`, `agent/embeddings.ts`)
- [x] Build agent runner: pass context, execute in sandbox (`agent/runner.ts`)
- [x] Write API routes: POST /session, GET /tenants, POST /tenants (`api/server.ts`)
- [x] Add S3 integration for artifact storage (`api/storage/s3.ts`)
- [ ] Build basic frontend or webhook interface
- [x] Write examples/ showing an end-to-end integration (`examples/basic-session.ts`)

---

## Tech Stack (suggested, adapt as needed)

| Layer          | Choice                                      |
|----------------|---------------------------------------------|
| API            | TypeScript + Express, run with Bun          |
| Agent          | OpenRouter (OpenAI-compatible) — one API for many models; default `anthropic/claude-sonnet-4.6` |
| Sandbox        | Daytona (self-hosted)                       |
| Database       | Postgres + pgvector                         |
| Object Storage | S3 / MinIO (self-hosted S3-compatible)      |
| Auth           | Tenant API keys (bearer)                    |
| Infra          | Docker Compose (dev) → Kubernetes (prod)    |

---

## Notes for Claude Code

- Use the Daytona Python or TypeScript SDK to manage sandboxes programmatically
- Each Daytona sandbox should be tagged with `tenant_id` for easy lookup
- Use `pgvector` cosine similarity search for memory retrieval — retrieve the top 5-10 most relevant past memories per session
- Keep the agent system prompt in a separate markdown file so it's easy to iterate on
- Schema-per-tenant means all queries must set the search path: `SET search_path TO tenant_{id}`
- Store the Daytona sandbox ID in Postgres so you can resume it on the next session rather than creating a new one each time
- Use environment variables for all secrets (Anthropic API key, Postgres URL, S3 credentials, Daytona API key)
- The `examples/` folder should show at least one end-to-end integration so open-source users can get started quickly