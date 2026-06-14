/**
 * Express auth middleware.
 *
 *   requireTenant — resolves a tenant from the `Authorization: Bearer <key>`
 *                   header and attaches it to req.tenant.
 *   requireAdmin  — gates provisioning/admin routes behind ADMIN_API_KEY.
 */
import type { NextFunction, Request, Response } from "express";
import { config } from "./config.ts";
import { getTenantByApiKey, type Tenant } from "./tenants/index.ts";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: Tenant;
    }
  }
}

function bearer(req: Request): string | null {
  const header = req.header("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

export async function requireTenant(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const key = bearer(req);
  if (!key) {
    res.status(401).json({ error: "Missing bearer token" });
    return;
  }
  const tenant = await getTenantByApiKey(key);
  if (!tenant) {
    res.status(403).json({ error: "Invalid tenant API key" });
    return;
  }
  req.tenant = tenant;
  next();
}

export function requireAdmin(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (bearer(req) !== config.api.adminApiKey) {
    res.status(403).json({ error: "Admin authorization required" });
    return;
  }
  next();
}
