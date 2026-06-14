/**
 * Shared LLM client.
 *
 * We talk to OpenRouter via the OpenAI-compatible API, so one client + key
 * reaches many providers' models (Anthropic, OpenAI, Google, etc.). Switch
 * models by changing the OpenRouter slug in AGENT_MODEL / SUMMARY_MODEL.
 */
import OpenAI from "openai";
import { config } from "../api/config.ts";

export const llm = new OpenAI({
  baseURL: config.llm.baseUrl,
  apiKey: config.llm.apiKey,
  // OpenRouter uses these for optional app attribution / rankings.
  defaultHeaders: {
    "HTTP-Referer": config.llm.appUrl,
    "X-Title": config.llm.appName,
  },
});

export const MODELS = {
  agent: config.llm.agentModel,
  summary: config.llm.summaryModel,
} as const;
