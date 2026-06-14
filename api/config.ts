/**
 * Central configuration loaded from environment variables.
 * Bun auto-loads `.env`, so no dotenv import is needed.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const config = {
  // LLM access goes through OpenRouter (OpenAI-compatible), so a single API key
  // and base URL reach many models. Model ids are OpenRouter slugs, e.g.
  // "anthropic/claude-sonnet-4.6", "openai/gpt-4.1", "google/gemini-2.5-pro".
  llm: {
    baseUrl: optional("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
    apiKey: required("OPENROUTER_API_KEY"),
    // Cheap defaults to avoid heavy model pricing; override per .env.
    agentModel: optional("AGENT_MODEL", "anthropic/claude-haiku-4.5"),
    summaryModel: optional("SUMMARY_MODEL", "google/gemini-2.5-flash-lite"),
    // Optional attribution headers OpenRouter uses for rankings.
    appUrl: optional("OPENROUTER_APP_URL", "https://github.com/agent-sandbox"),
    appName: optional("OPENROUTER_APP_NAME", "agent-sandbox"),
  },
  embeddings: {
    // OpenRouter is chat-only; embeddings use a dedicated provider.
    provider: optional("EMBEDDING_PROVIDER", "local"),
    model: optional("EMBEDDING_MODEL", "voyage-3"),
    voyageApiKey: optional("VOYAGE_API_KEY", ""),
  },
  postgres: {
    url: required("DATABASE_URL"),
  },
  daytona: {
    apiUrl: optional("DAYTONA_API_URL", "http://localhost:3986"),
    apiKey: optional("DAYTONA_API_KEY", ""),
  },
  s3: {
    endpoint: optional("S3_ENDPOINT", "http://localhost:9000"),
    region: optional("S3_REGION", "us-east-1"),
    bucket: optional("S3_BUCKET", "agent-sandbox"),
    accessKeyId: required("S3_ACCESS_KEY_ID"),
    secretAccessKey: required("S3_SECRET_ACCESS_KEY"),
    forcePathStyle: optional("S3_FORCE_PATH_STYLE", "true") === "true",
  },
  api: {
    port: parseInt(optional("PORT", "8080"), 10),
    adminApiKey: required("ADMIN_API_KEY"),
  },
} as const;

export type Config = typeof config;
