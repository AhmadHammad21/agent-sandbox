# Architecture

How agent-sandbox isolates a persistent AI agent per tenant. Diagrams use
[Mermaid](https://mermaid.js.org/) and render on GitHub.

## 1. System overview

```mermaid
flowchart TB
    client["Tenant client<br/>(Bearer api_key)"]

    subgraph api["API layer (Bun + Express)"]
        auth["auth.ts<br/>resolve tenant by api_key"]
        routes["server.ts<br/>/session /tenants /artifacts"]
        session["agents/session.ts"]
        runner["agent/runner.ts<br/>tool-use loop"]
        sbmgr["sandboxes/manager.ts"]
        mem["agent/memory.ts<br/>+ embeddings.ts"]
        s3mod["storage/s3.ts"]
    end

    llm["OpenRouter<br/>(one API → many models)"]

    subgraph daytona["Daytona runtime"]
        sbA["Sandbox tenant_A"]
        sbB["Sandbox tenant_B"]
    end

    subgraph pg["Postgres + pgvector"]
        ctrl["public.tenants<br/>(registry)"]
        schA["schema tenant_A<br/>conversations · messages<br/>agent_memory · sandbox_state"]
        schB["schema tenant_B<br/>…"]
    end

    subgraph s3["S3 / MinIO"]
        prefA["tenant-A/"]
        prefB["tenant-B/"]
    end

    client --> auth --> routes --> session --> runner
    auth -.lookup.-> ctrl
    runner --> sbmgr
    runner --> mem
    runner --> llm
    runner --> s3mod
    sbmgr --> sbA
    sbmgr --> sbB
    sbmgr -. sandbox_id .- schA
    mem --> schA
    mem --> schB
    s3mod --> prefA
    s3mod --> prefB
```

The API is the only component that talks to everything; each tenant's compute
(Daytona sandbox), state (Postgres schema), and files (S3 prefix) are separate.

## 2. Isolation model — the core idea

Every tenant is fenced off on three axes. The tenant id (`[a-z0-9_]+`,
validated) is the key that ties the three together.

```mermaid
flowchart LR
    subgraph T["tenant_id = acme"]
        direction TB
        c["Compute<br/>1 Daytona sandbox<br/>labelled tenant_id=acme"]
        d["State<br/>Postgres schema tenant_acme<br/>(search_path scoped per query)"]
        f["Files<br/>S3 prefix tenant-acme/"]
    end
```

| Axis | Mechanism | Where |
|------|-----------|-------|
| Compute | One persistent Daytona sandbox per tenant, labelled `tenant_id` | `src/api/sandboxes/manager.ts` |
| State | One Postgres **schema** `tenant_{id}`; every query runs with `SET search_path` | `src/api/db.ts` (`withTenant`) |
| Files | One S3 **prefix** `tenant-{id}/` | `src/api/storage/s3.ts` |

A cross-tenant query is impossible by construction: tenant-scoped DB access only
happens inside `withTenant(tenantId, …)`, which sets the search path; the
registry that maps api_key → tenant lives in the separate `public` schema.

## 3. Per-session flow

What happens on `POST /session` with a tenant's bearer key:

```mermaid
sequenceDiagram
    autonumber
    actor U as Tenant
    participant API as API + auth
    participant R as runner
    participant SB as Daytona sandbox
    participant DB as Postgres (tenant schema)
    participant LLM as OpenRouter

    U->>API: POST /session {message} (Bearer api_key)
    API->>DB: resolve tenant by api_key (public.tenants)
    API->>R: handleSession(tenantId, message)

    R->>SB: getOrCreateSandbox() — resume by stored sandbox_id
    par gather context
        R->>DB: recallMemories() (pgvector cosine top-k)
    and
        R->>DB: recentMessages() (history)
    end
    R->>DB: save user message

    loop tool-use loop (max 12 turns)
        R->>LLM: chat.completions (system + history + tools)
        alt model returns tool_calls
            LLM-->>R: tool_calls
            R->>SB: run_code / exec / read_file / write_file
            SB-->>R: tool output
            R->>DB: remember() facts → agent_memory (+ embedding)
        else final answer
            LLM-->>R: assistant text
        end
    end

    R->>DB: save assistant message
    R-->>U: { reply, conversationId }
```

Key persistence points: the sandbox is **resumed** (not recreated) via the
`sandbox_id` in `sandbox_state`; conversation and remembered facts are written
back to the tenant's schema — so the next session continues with full context.

## 4. Sandbox lifecycle

```mermaid
stateDiagram-v2
    [*] --> none: tenant has no sandbox
    none --> running: create (labelled tenant_id)
    running --> paused: pauseSandbox()
    paused --> running: getOrCreateSandbox() → start
    running --> running: getOrCreateSandbox() (resume)
    running --> [*]: deleteSandbox()
    paused --> [*]: deleteSandbox()
    note right of running
        sandbox_id + status tracked
        in tenant's sandbox_state table
    end note
```

If the recorded sandbox no longer exists in Daytona, `getOrCreateSandbox()`
transparently provisions a fresh one and updates `sandbox_state`.

## Why these choices

- **Schema-per-tenant** (not row-level `tenant_id` columns) gives hard isolation
  and trivial per-tenant export/drop, while sharing one Postgres instance and
  the `pgvector` extension.
- **One sandbox per tenant** makes the agent stateful — its filesystem and
  installed tools persist — which is the whole point versus a throwaway runner.
- **OpenRouter** keeps the model a config value, so cost/quality is tuned via
  `AGENT_MODEL` without touching code.
