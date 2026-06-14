/**
 * Agent runner: assembles context, runs the OpenRouter (OpenAI-compatible)
 * tool-use loop against the tenant's sandbox, and persists the messages.
 *
 * Per-session flow (see PLAN.md):
 *   resume sandbox → recall memory + recent history → run agent → save messages
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type OpenAI from "openai";
import { llm, MODELS } from "./llm.ts";
import {
  recallMemories,
  recentMessages,
  saveMessage,
  type Message,
} from "./memory.ts";
import { runTool, toolDefinitions, type ToolContext } from "./tools/index.ts";
import { getOrCreateSandbox } from "../api/sandboxes/manager.ts";

const here = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = await readFile(join(here, "system_prompt.md"), "utf8");

const MAX_TOOL_TURNS = 12;

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export interface RunResult {
  reply: string;
  conversationId: string;
}

/**
 * Run one user turn for a tenant within an existing conversation.
 * Returns the agent's final text reply.
 */
export async function runSession(
  tenantId: string,
  conversationId: string,
  userInput: string,
): Promise<RunResult> {
  const sandbox = await getOrCreateSandbox(tenantId);
  const ctx: ToolContext = { tenantId, sandbox };

  // Gather context in parallel.
  const [memories, history] = await Promise.all([
    recallMemories(tenantId, userInput, 8),
    recentMessages(tenantId, conversationId, 30),
  ]);

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystem(memories.map((m) => m.content)) },
    ...toChatMessages(history),
    { role: "user", content: userInput },
  ];

  await saveMessage(tenantId, conversationId, "user", userInput);

  let finalText = "";

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await llm.chat.completions.create({
      model: MODELS.agent,
      max_tokens: 4096,
      tools: toolDefinitions,
      messages,
    });

    const choice = response.choices[0];
    const msg = choice.message;
    messages.push(msg);

    if (msg.content) finalText = msg.content;

    const toolCalls = msg.tool_calls ?? [];
    if (toolCalls.length === 0) break;

    for (const call of toolCalls) {
      if (call.type !== "function") continue;
      let result: string;
      try {
        const args = JSON.parse(call.function.arguments || "{}") as Record<
          string,
          unknown
        >;
        result = await runTool(ctx, call.function.name, args);
      } catch (err) {
        result = `Tool error: ${(err as Error).message}`;
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: result,
      });
    }
  }

  await saveMessage(tenantId, conversationId, "assistant", finalText);
  return { reply: finalText, conversationId };
}

function buildSystem(memories: string[]): string {
  if (memories.length === 0) return SYSTEM_PROMPT;
  const recalled = memories.map((m) => `- ${m}`).join("\n");
  return `${SYSTEM_PROMPT}\n\n## Recalled memories\n\nThese may be relevant to the current request:\n\n${recalled}`;
}

/** Map stored messages to chat message params (tool rows are skipped). */
function toChatMessages(history: Message[]): ChatMessage[] {
  return history
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) =>
      m.role === "assistant"
        ? { role: "assistant", content: m.content }
        : { role: "user", content: m.content },
    );
}
