/**
 * Agent session orchestration. Thin layer over the agent runner that ensures a
 * conversation exists before the turn runs.
 */
import { createConversation } from "../../agent/memory.ts";
import { runSession, type RunResult } from "../../agent/runner.ts";

export interface SessionInput {
  tenantId: string;
  message: string;
  /** Continue an existing conversation; omit to start a new one. */
  conversationId?: string;
}

export async function handleSession(input: SessionInput): Promise<RunResult> {
  const conversationId =
    input.conversationId ?? (await createConversation(input.tenantId));
  return runSession(input.tenantId, conversationId, input.message);
}
