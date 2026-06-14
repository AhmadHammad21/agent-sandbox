-- Control-plane migration: runs once against the database (public schema).
-- Sets up the extension shared by all tenant schemas and the tenant registry.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- Registry of all tenants. Lives in the public schema; tenant data lives in
-- per-tenant schemas (tenant_{id}).
CREATE TABLE IF NOT EXISTS tenants (
  id          TEXT PRIMARY KEY,        -- slug, [a-z0-9_]+
  name        TEXT NOT NULL,
  api_key     TEXT UNIQUE NOT NULL,    -- bearer key the tenant authenticates with
  s3_prefix   TEXT NOT NULL,           -- e.g. 'tenant-abc/'
  status      TEXT NOT NULL DEFAULT 'active', -- 'active' | 'archived'
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenants_api_key_idx ON tenants (api_key);
