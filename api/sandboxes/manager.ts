/**
 * Daytona sandbox lifecycle: create, resume, pause, stop, delete.
 *
 * Each tenant has at most one persistent sandbox. We store its Daytona id in
 * the tenant's sandbox_state table so we resume the same workspace next session
 * instead of provisioning a fresh one. Sandboxes are also labelled with the
 * tenant id so they can be found directly from Daytona if the DB is lost.
 */
import { Daytona, type Sandbox } from "@daytonaio/sdk";
import { config } from "../config.ts";
import { withTenant } from "../db.ts";

const daytona = new Daytona({
  apiKey: config.daytona.apiKey || undefined,
  apiUrl: config.daytona.apiUrl,
});

export interface SandboxRecord {
  sandbox_id: string;
  status: "running" | "paused" | "stopped";
}

async function readState(tenantId: string): Promise<SandboxRecord | null> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query<SandboxRecord>(
      "SELECT sandbox_id, status FROM sandbox_state ORDER BY last_active DESC LIMIT 1",
    );
    return rows[0] ?? null;
  });
}

async function writeState(
  tenantId: string,
  sandboxId: string,
  status: SandboxRecord["status"],
): Promise<void> {
  await withTenant(tenantId, async (c) => {
    const { rowCount } = await c.query(
      `UPDATE sandbox_state
         SET status = $2, last_active = now()
       WHERE sandbox_id = $1`,
      [sandboxId, status],
    );
    if (!rowCount) {
      await c.query(
        "INSERT INTO sandbox_state (sandbox_id, status) VALUES ($1, $2)",
        [sandboxId, status],
      );
    }
  });
}

/**
 * Return a running sandbox for the tenant, creating or resuming as needed.
 * This is the entry point the agent runner uses each session.
 */
export async function getOrCreateSandbox(tenantId: string): Promise<Sandbox> {
  const state = await readState(tenantId);

  if (state) {
    const sandbox = await daytona.get(state.sandbox_id).catch(() => null);
    if (sandbox) {
      if (state.status !== "running") {
        await daytona.start(sandbox);
      }
      await writeState(tenantId, sandbox.id, "running");
      return sandbox;
    }
    // Recorded sandbox no longer exists in Daytona — fall through to recreate.
  }

  const sandbox = await daytona.create({
    language: "typescript",
    labels: { tenant_id: tenantId },
  });
  await writeState(tenantId, sandbox.id, "running");
  return sandbox;
}

/** Pause the tenant's sandbox (keeps state, frees compute). */
export async function pauseSandbox(tenantId: string): Promise<void> {
  const state = await readState(tenantId);
  if (!state) return;
  const sandbox = await daytona.get(state.sandbox_id).catch(() => null);
  if (sandbox) await daytona.stop(sandbox);
  await writeState(tenantId, state.sandbox_id, "paused");
}

/** Destroy the tenant's sandbox entirely. */
export async function deleteSandbox(tenantId: string): Promise<void> {
  const state = await readState(tenantId);
  if (!state) return;
  const sandbox = await daytona.get(state.sandbox_id).catch(() => null);
  if (sandbox) await daytona.delete(sandbox);
  await withTenant(tenantId, (c) =>
    c.query("DELETE FROM sandbox_state WHERE sandbox_id = $1", [
      state.sandbox_id,
    ]),
  );
}

export { daytona };
