/**
 * Embedding provider for pgvector memory.
 *
 * The agent_memory.embedding column is VECTOR(1536) (see db/schema.sql), so
 * whatever provider you use MUST emit 1536-dimensional vectors — or you must
 * change the schema dimension to match.
 *
 * Two backends:
 *   - "voyage": Anthropic's recommended embedding partner. Set EMBEDDING_PROVIDER=voyage
 *     and VOYAGE_API_KEY. NOTE: voyage models output 1024/2048 dims, so if you
 *     use this you must update the VECTOR(...) dimension in db/schema.sql.
 *   - "local" (default): a deterministic hashing embedder. Dependency-free and
 *     runs the scaffold out of the box, but it is NOT semantically meaningful —
 *     swap in a real provider before relying on memory recall quality.
 */
import { config } from "../api/config.ts";

export const EMBEDDING_DIM = 1536;

const provider = config.embeddings.provider;

/** Whether semantic (vector) memory is active. When false, recall is skipped. */
export const embeddingsEnabled = provider !== "none";

export async function embed(text: string): Promise<number[]> {
  if (!embeddingsEnabled) {
    throw new Error("Embeddings are disabled (EMBEDDING_PROVIDER=none)");
  }
  if (provider === "voyage") return embedVoyage(text);
  return embedLocal(text);
}

/** Format a JS number[] as a pgvector literal: '[1,2,3]'. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}

// --- voyage backend ---------------------------------------------------------

async function embedVoyage(text: string): Promise<number[]> {
  const key = config.embeddings.voyageApiKey;
  if (!key) throw new Error("EMBEDDING_PROVIDER=voyage requires VOYAGE_API_KEY");
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({ model: config.embeddings.model, input: text }),
  });
  if (!res.ok) {
    throw new Error(`Voyage embeddings failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { data: { embedding: number[] }[] };
  return json.data[0].embedding;
}

// --- local dev backend ------------------------------------------------------

/**
 * Deterministic bag-of-words hashing into a fixed-dim, L2-normalized vector.
 * Good enough to exercise the pipeline; not good enough for production recall.
 */
function embedLocal(text: string): number[] {
  const vec = new Array<number>(EMBEDDING_DIM).fill(0);
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  for (const tok of tokens) {
    let h = 2166136261;
    for (let i = 0; i < tok.length; i++) {
      h ^= tok.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % EMBEDDING_DIM;
    vec[idx] += 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}
