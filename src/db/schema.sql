-- Base schema applied once per tenant.
--
-- Usage (handled programmatically by api/tenants/provision.ts):
--   CREATE SCHEMA tenant_{id};
--   SET search_path TO tenant_{id};
--   \i db/schema.sql
--
-- The pgvector extension is installed once per database (see
-- db/migrations/0001_control_plane.sql), not per schema.

CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  summary TEXT
);

CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL, -- 'user' | 'assistant' | 'tool'
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at);

CREATE TABLE agent_memory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  embedding VECTOR(1536),  -- pgvector: semantic memory
  created_at TIMESTAMPTZ DEFAULT now(),
  source TEXT              -- e.g. 'conversation', 'file', 'user_note'
);

-- IVFFlat index for cosine-similarity recall. Tune `lists` as memory grows.
CREATE INDEX agent_memory_embedding_idx
  ON agent_memory USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

CREATE TABLE sandbox_state (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sandbox_id TEXT NOT NULL,   -- Daytona sandbox ID
  status TEXT NOT NULL,       -- 'running' | 'paused' | 'stopped'
  last_active TIMESTAMPTZ DEFAULT now()
);
