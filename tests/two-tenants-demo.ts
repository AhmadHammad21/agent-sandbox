/**
 * Demo: two tenants, each with its own agent + sandbox.
 *
 * 1. Provision tenant_one and tenant_two.
 * 2. Each agent writes and runs a dummy TS/JS script in its own sandbox.
 * 3. tenant_one writes a secret file into its sandbox; tenant_two then tries to
 *    read that same path in its sandbox — and can't, because the sandboxes are
 *    fully isolated (compute isolation).
 *
 *   bun tests/two-tenants-demo.ts
 *
 * This is an interactive demo (real Daytona + OpenRouter calls). The automated,
 * deterministic isolation guarantee is in tests/isolation.test.ts.
 */
import { pool } from "../src/api/db.ts";
import { getTenant } from "../src/api/tenants/index.ts";
import { provisionTenant } from "../src/api/tenants/provision.ts";
import { handleSession } from "../src/api/agents/session.ts";

const SECRET_PATH = "/tmp/tenant_secret.txt";

async function ensureTenant(id: string, name: string) {
  if (!(await getTenant(id))) {
    const t = await provisionTenant(id, name);
    console.log(`provisioned ${t.id} (api_key ${t.api_key.slice(0, 12)}…)`);
  } else {
    console.log(`tenant ${id} already exists`);
  }
}

async function main() {
  await ensureTenant("tenant_one", "Tenant One");
  await ensureTenant("tenant_two", "Tenant Two");

  console.log("\n=== tenant_one: run a dummy TypeScript script ===");
  const one = await handleSession({
    tenantId: "tenant_one",
    message:
      "Use run_code (typescript) to print the first 8 Fibonacci numbers as a " +
      `comma-separated line. Then write the text "TENANT_ONE_SECRET" to the ` +
      `file ${SECRET_PATH} using write_file. Report the Fibonacci output.`,
  });
  console.log("tenant_one agent:", one.reply);

  console.log("\n=== tenant_two: run a dummy JavaScript script ===");
  const two = await handleSession({
    tenantId: "tenant_two",
    message:
      "Use run_code (javascript) to print the squares of 1..6 as a " +
      "comma-separated line. Report that output.",
  });
  console.log("tenant_two agent:", two.reply);

  console.log("\n=== isolation check: tenant_two tries to read tenant_one's secret file ===");
  const probe = await handleSession({
    tenantId: "tenant_two",
    message:
      `Use read_file to read ${SECRET_PATH}. If it does not exist or errors, ` +
      `reply exactly "NO ACCESS". If you can read it, reply with its contents.`,
  });
  console.log("tenant_two agent:", probe.reply);

  const leaked = probe.reply.includes("TENANT_ONE_SECRET");
  console.log(
    `\nResult: tenant_two ${leaked ? "LEAKED tenant_one's secret ❌" : "could NOT see tenant_one's secret ✅"}`,
  );

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
