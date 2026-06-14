/**
 * Tenant isolation guarantees (data layer).
 *
 * Proves that an agent operating as tenant A cannot see ANY of tenant B's data:
 * conversations, messages, or memory. This is the core promise of the
 * schema-per-tenant design — every tenant-scoped query runs with
 * search_path = tenant_{id}, public, so cross-tenant reads are impossible.
 *
 *   bun test
 *
 * Deterministic: no LLM or Daytona calls. Requires only Postgres
 * (docker compose up + bun run migrate).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { control, pool, schemaName, withTenant } from "../src/api/db.ts";
import { provisionTenant } from "../src/api/tenants/provision.ts";
import {
  createConversation,
  recentMessages,
  rememberFact,
  saveMessage,
} from "../src/agent/memory.ts";

// Unique ids per run so repeated runs don't collide.
const suffix = Date.now().toString(36);
const A = `iso_a_${suffix}`;
const B = `iso_b_${suffix}`;

const SECRET_A = "SECRET_OWNED_BY_TENANT_A";

let convoA: string;

beforeAll(async () => {
  await provisionTenant(A, "Isolation Tenant A");
  await provisionTenant(B, "Isolation Tenant B");

  // Tenant A produces some data: a conversation, a message, and a memory.
  convoA = await createConversation(A);
  await saveMessage(A, convoA, "user", SECRET_A);
  await rememberFact(A, SECRET_A, "user_note");
});

afterAll(async () => {
  for (const id of [A, B]) {
    await control(`DROP SCHEMA IF EXISTS "${schemaName(id)}" CASCADE`);
    await control("DELETE FROM tenants WHERE id = $1", [id]);
  }
  await pool.end();
});

describe("tenant isolation", () => {
  test("tenant A's own data is present in tenant A", async () => {
    const msgs = await recentMessages(A, convoA, 10);
    expect(msgs.map((m) => m.content)).toContain(SECRET_A);

    const mem = await withTenant(A, (c) =>
      c.query("SELECT count(*)::int AS n FROM agent_memory"),
    );
    expect(mem.rows[0].n).toBeGreaterThan(0);
  });

  test("tenant B sees zero messages and zero memory", async () => {
    const msgCount = await withTenant(B, (c) =>
      c.query("SELECT count(*)::int AS n FROM messages"),
    );
    expect(msgCount.rows[0].n).toBe(0);

    const memCount = await withTenant(B, (c) =>
      c.query("SELECT count(*)::int AS n FROM agent_memory"),
    );
    expect(memCount.rows[0].n).toBe(0);
  });

  test("tenant B cannot find tenant A's secret by content", async () => {
    const hit = await withTenant(B, (c) =>
      c.query("SELECT count(*)::int AS n FROM messages WHERE content = $1", [
        SECRET_A,
      ]),
    );
    expect(hit.rows[0].n).toBe(0);
  });

  test("tenant B's conversation history is empty (no cross-tenant bleed)", async () => {
    // A fresh, B-owned conversation must not surface A's messages.
    const convoB = await createConversation(B);
    const msgs = await recentMessages(B, convoB, 50);
    expect(msgs).toHaveLength(0);
  });

  test("tenant ids are validated to prevent search_path injection", () => {
    expect(() => schemaName("ok_123")).not.toThrow();
    expect(() => schemaName("bad-id")).toThrow();
    expect(() => schemaName("evil; DROP")).toThrow();
    expect(() => schemaName("a.b")).toThrow();
  });
});
