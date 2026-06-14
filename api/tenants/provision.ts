/**
 * Onboard a new tenant (PLAN.md › Tenant Lifecycle):
 *   1. CREATE SCHEMA tenant_{id}
 *   2. apply db/schema.sql inside it
 *   3. register the tenant + API key in the control plane
 *   4. create the S3 prefix tenant-{id}/
 *
 * CLI:  bun run provision <tenant_id> "Display Name"
 * Lib:  await provisionTenant("acme", "Acme Inc")
 */
import { randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { control, pool, schemaName } from "../db.ts";
import { putArtifact, tenantPrefix } from "../storage/s3.ts";
import { getTenant, type Tenant } from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SCHEMA_SQL = join(here, "..", "..", "db", "schema.sql");

export async function provisionTenant(
  id: string,
  name: string,
): Promise<Tenant> {
  const schema = schemaName(id); // validates id format
  const existing = await getTenant(id);
  if (existing) throw new Error(`Tenant '${id}' already exists`);

  const apiKey = `ten_${randomBytes(24).toString("hex")}`;
  const schemaSql = await readFile(SCHEMA_SQL, "utf8");
  const prefix = tenantPrefix(id);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"`);
    await client.query(`SET search_path TO "${schema}"`);
    await client.query(schemaSql);
    await client.query("RESET search_path");
    await client.query(
      `INSERT INTO tenants (id, name, api_key, s3_prefix)
       VALUES ($1, $2, $3, $4)`,
      [id, name, apiKey, prefix],
    );
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  // Create the S3 prefix with a marker object (best-effort).
  await putArtifact(id, ".keep", "", "text/plain").catch((err) =>
    console.warn(`Warning: could not create S3 prefix: ${err.message}`),
  );

  const { rows } = await control<Tenant>(
    "SELECT * FROM tenants WHERE id = $1",
    [id],
  );
  return rows[0];
}

// --- CLI entry point --------------------------------------------------------

if (import.meta.main) {
  const [id, name] = process.argv.slice(2);
  if (!id) {
    console.error('Usage: bun run provision <tenant_id> "Display Name"');
    process.exit(1);
  }
  const tenant = await provisionTenant(id, name ?? id);
  console.log("Provisioned tenant:");
  console.log(`  id:      ${tenant.id}`);
  console.log(`  name:    ${tenant.name}`);
  console.log(`  api_key: ${tenant.api_key}`);
  console.log(`  s3:      ${tenant.s3_prefix}`);
  await pool.end();
}
