/**
 * End-to-end example: provision a tenant, run two agent turns in one
 * conversation, and show that memory/state carries across turns.
 *
 *   bun run example
 *
 * Requires the local stack (docker compose) + migrations applied + a Daytona
 * endpoint + ANTHROPIC_API_KEY. See README.md.
 */
import { pool } from "../api/db.ts";
import { getTenant } from "../api/tenants/index.ts";
import { provisionTenant } from "../api/tenants/provision.ts";
import { handleSession } from "../api/agents/session.ts";

const TENANT_ID = "demo";

async function main() {
  // 1. Provision the tenant if it doesn't exist yet (idempotent for the demo).
  if (!(await getTenant(TENANT_ID))) {
    const t = await provisionTenant(TENANT_ID, "Demo Tenant");
    console.log(`Provisioned tenant '${t.id}' (api_key ${t.api_key})\n`);
  }

  // 2. First turn — starts a new conversation.
  const first = await handleSession({
    tenantId: TENANT_ID,
    message:
      "Create a file workspace/notes.txt containing 'hello from the sandbox', " +
      "then read it back and tell me what it says.",
  });
  console.log("Agent:", first.reply, "\n");

  // 3. Second turn — continues the same conversation; the sandbox file persists.
  const second = await handleSession({
    tenantId: TENANT_ID,
    conversationId: first.conversationId,
    message: "What was in the file you just created?",
  });
  console.log("Agent:", second.reply, "\n");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
