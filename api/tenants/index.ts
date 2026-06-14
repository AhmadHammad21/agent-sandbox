/**
 * Tenant registry operations (control plane, public schema).
 */
import { control } from "../db.ts";

export interface Tenant {
  id: string;
  name: string;
  api_key: string;
  s3_prefix: string;
  status: "active" | "archived";
  created_at: string;
}

export async function listTenants(): Promise<Tenant[]> {
  const { rows } = await control<Tenant>(
    "SELECT * FROM tenants ORDER BY created_at DESC",
  );
  return rows;
}

export async function getTenant(id: string): Promise<Tenant | null> {
  const { rows } = await control<Tenant>(
    "SELECT * FROM tenants WHERE id = $1",
    [id],
  );
  return rows[0] ?? null;
}

/** Resolve a tenant by its bearer API key (used for request auth). */
export async function getTenantByApiKey(apiKey: string): Promise<Tenant | null> {
  const { rows } = await control<Tenant>(
    "SELECT * FROM tenants WHERE api_key = $1 AND status = 'active'",
    [apiKey],
  );
  return rows[0] ?? null;
}
