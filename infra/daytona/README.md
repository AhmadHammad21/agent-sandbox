# Daytona (self-hosted)

agent-sandbox uses [Daytona](https://www.daytona.io/) as the per-tenant sandbox
runtime. Daytona is self-hostable and AGPL-3.0.

## Quick start

Daytona ships its own installer rather than a single compose file, so it lives
outside `infra/docker-compose.yml`. Follow the official self-host guide:

- Docs: https://www.daytona.io/docs/
- Self-host: https://www.daytona.io/docs/installation/self-hosted/

After the server is running, point the API at it via `.env`:

```
DAYTONA_API_URL=http://localhost:3986
DAYTONA_API_KEY=<key from the Daytona dashboard>
```

## How agent-sandbox uses Daytona

- One persistent sandbox per tenant, labelled `tenant_id=<id>`.
- The sandbox id is stored in each tenant's `sandbox_state` table so sessions
  resume the same workspace instead of creating a new one.
- See `api/sandboxes/manager.ts` for the lifecycle (create / resume / pause /
  delete) and `agent/tools/index.ts` for how the agent executes code and
  reads/writes files inside the sandbox.

## Managed alternative

If you don't want to self-host, Daytona offers a hosted API. Set `DAYTONA_API_URL`
and `DAYTONA_API_KEY` to the managed endpoint and credentials — no other changes
are needed.
