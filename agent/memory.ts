/**
 * Memory retrieval and storage helpers.
 *
 * Two kinds of state per tenant:
 *   - conversation history (conversations / messages tables)
 *   - semantic memory (agent_memory table, recalled via pgvector cosine search)
 *
 * All queries are tenant-scoped through withTenant() which sets search_path.
 */
import { withTenant } from "../api/db.ts";
import { embed, toVector } from "./embeddings.ts";

export type Role = "user" | "assistant" | "tool";

export interface Message {
  id: string;
  conversation_id: string;
  role: Role;
  content: string;
  created_at: string;
}

/** Create a new conversation and return its id. */
export async function createConversation(tenantId: string): Promise<string> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      "INSERT INTO conversations DEFAULT VALUES RETURNING id",
    );
    return rows[0].id;
  });
}

/** Append a message to a conversation. */
export async function saveMessage(
  tenantId: string,
  conversationId: string,
  role: Role,
  content: string,
): Promise<void> {
  await withTenant(tenantId, (c) =>
    c.query(
      "INSERT INTO messages (conversation_id, role, content) VALUES ($1, $2, $3)",
      [conversationId, role, content],
    ),
  );
}

/** Most recent messages in a conversation, oldest-first for replay. */
export async function recentMessages(
  tenantId: string,
  conversationId: string,
  limit = 30,
): Promise<Message[]> {
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query<Message>(
      `SELECT * FROM (
         SELECT * FROM messages
         WHERE conversation_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       ) t ORDER BY created_at ASC`,
      [conversationId, limit],
    );
    return rows;
  });
}

/** Store a memory with its embedding for later semantic recall. */
export async function rememberFact(
  tenantId: string,
  content: string,
  source = "conversation",
): Promise<void> {
  const vector = toVector(await embed(content));
  await withTenant(tenantId, (c) =>
    c.query(
      "INSERT INTO agent_memory (content, embedding, source) VALUES ($1, $2, $3)",
      [content, vector, source],
    ),
  );
}

export interface RecalledMemory {
  id: string;
  content: string;
  source: string | null;
  similarity: number;
}

/**
 * Recall the top-k most relevant memories for a query via cosine similarity.
 * `<=>` is pgvector's cosine distance; similarity = 1 - distance.
 */
export async function recallMemories(
  tenantId: string,
  query: string,
  k = 8,
): Promise<RecalledMemory[]> {
  const vector = toVector(await embed(query));
  return withTenant(tenantId, async (c) => {
    const { rows } = await c.query<RecalledMemory>(
      `SELECT id, content, source, 1 - (embedding <=> $1) AS similarity
       FROM agent_memory
       WHERE embedding IS NOT NULL
       ORDER BY embedding <=> $1
       LIMIT $2`,
      [vector, k],
    );
    return rows;
  });
}
