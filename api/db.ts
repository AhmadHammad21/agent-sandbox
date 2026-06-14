/**
 * Postgres connection pool + per-tenant query helpers.
 *
 * We use schema-per-tenant isolation. Every tenant-scoped query runs with
 * `SET search_path TO tenant_{id}` so the same SQL hits the right schema.
 */
import pg from "pg";
import { config } from "./config.ts";

export const pool = new pg.Pool({ connectionString: config.postgres.url });

/** Postgres identifiers must be safe before interpolation into `SET search_path`. */
export function schemaName(tenantId: string): string {
  if (!/^[a-z0-9_]+$/.test(tenantId)) {
    throw new Error(`Invalid tenant id: ${tenantId}`);
  }
  return `tenant_${tenantId}`;
}

/**
 * Run a function with a client whose search_path is scoped to the tenant's
 * schema. The client is always released, and search_path reset, afterwards.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const schema = schemaName(tenantId);
  const client = await pool.connect();
  try {
    // schema is validated by schemaName(); safe to interpolate.
    await client.query(`SET search_path TO "${schema}"`);
    return await fn(client);
  } finally {
    await client.query("RESET search_path").catch(() => {});
    client.release();
  }
}

/** Run a query against the `public`/control-plane schema (tenant registry). */
export async function control<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params as never);
}
