/**
 * HTTP API. Routes (see PLAN.md › Key Implementation Tasks):
 *
 *   GET  /health                 — liveness
 *   POST /tenants                 — provision a tenant            [admin]
 *   GET  /tenants                 — list tenants                  [admin]
 *   POST /session                 — run an agent turn             [tenant]
 *   GET  /artifacts               — list the tenant's S3 objects  [tenant]
 *
 * Tenant routes authenticate with `Authorization: Bearer <tenant api_key>`.
 * Admin routes use the ADMIN_API_KEY.
 */
import express from "express";
import { config } from "./config.ts";
import { requireAdmin, requireTenant } from "./auth.ts";
import { handleSession } from "./agents/session.ts";
import { listTenants } from "./tenants/index.ts";
import { provisionTenant } from "./tenants/provision.ts";
import { listArtifacts } from "./storage/s3.ts";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

// --- admin / control plane --------------------------------------------------

app.post("/tenants", requireAdmin, async (req, res) => {
  const { id, name } = req.body ?? {};
  if (!id) {
    res.status(400).json({ error: "id is required" });
    return;
  }
  try {
    const tenant = await provisionTenant(id, name ?? id);
    res.status(201).json(tenant);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.get("/tenants", requireAdmin, async (_req, res) => {
  res.json(await listTenants());
});

// --- tenant plane -----------------------------------------------------------

app.post("/session", requireTenant, async (req, res) => {
  const { message, conversationId } = req.body ?? {};
  if (!message) {
    res.status(400).json({ error: "message is required" });
    return;
  }
  try {
    const result = await handleSession({
      tenantId: req.tenant!.id,
      message,
      conversationId,
    });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.get("/artifacts", requireTenant, async (req, res) => {
  res.json({ artifacts: await listArtifacts(req.tenant!.id) });
});

app.listen(config.api.port, () => {
  console.log(`agent-sandbox API listening on :${config.api.port}`);
});
