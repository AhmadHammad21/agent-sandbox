/**
 * Tools the agent can use. Each tool is an Anthropic tool definition plus an
 * executor that runs against the tenant's Daytona sandbox.
 */
import type OpenAI from "openai";
import type { Sandbox } from "@daytonaio/sdk";
import { rememberFact } from "../memory.ts";

export const toolDefinitions: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "run_code",
      description:
        "Run a snippet of code inside the tenant's persistent sandbox and return stdout/stderr. Use for computation, scripting, and testing ideas.",
      parameters: {
        type: "object",
        properties: {
          language: {
            type: "string",
            enum: ["python", "typescript", "javascript", "bash"],
            description: "Language/runtime to execute the snippet with.",
          },
          code: { type: "string", description: "The code to execute." },
        },
        required: ["language", "code"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exec",
      description:
        "Run a shell command in the sandbox (e.g. install a package, list files). Returns combined output.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to run." },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file from the sandbox filesystem.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute or workspace-relative path.",
          },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description:
        "Write (create or overwrite) a file in the sandbox filesystem.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remember",
      description:
        "Persist an important fact to long-term memory so it can be recalled in future sessions. Use for durable preferences, decisions, and project facts — not transient details.",
      parameters: {
        type: "object",
        properties: {
          fact: {
            type: "string",
            description: "A single self-contained fact.",
          },
        },
        required: ["fact"],
      },
    },
  },
];

export interface ToolContext {
  tenantId: string;
  sandbox: Sandbox;
}

/** Execute a tool call and return a string result for the model. */
export async function runTool(
  ctx: ToolContext,
  name: string,
  input: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case "run_code": {
      const language = String(input.language);
      const code = String(input.code);
      return runCode(ctx, language, code);
    }
    case "exec":
      return execCommand(ctx, String(input.command));
    case "read_file": {
      const buf = await ctx.sandbox.fs.downloadFile(String(input.path));
      return buf.toString("utf8");
    }
    case "write_file": {
      const content = Buffer.from(String(input.content), "utf8");
      await ctx.sandbox.fs.uploadFile(content, String(input.path));
      return `Wrote ${content.byteLength} bytes to ${input.path}`;
    }
    case "remember": {
      await rememberFact(ctx.tenantId, String(input.fact), "user_note");
      return "Saved to long-term memory.";
    }
    default:
      return `Unknown tool: ${name}`;
  }
}

async function execCommand(ctx: ToolContext, command: string): Promise<string> {
  const res = await ctx.sandbox.process.executeCommand(command);
  const out = res.result ?? "";
  return res.exitCode === 0 ? out : `exit ${res.exitCode}\n${out}`;
}

/**
 * Run a code snippet in the requested language. The sandbox's default runtime
 * (codeRun) is Python, so for everything else we write the snippet to a temp
 * file and invoke the right interpreter (bun handles both TS and JS).
 */
async function runCode(
  ctx: ToolContext,
  language: string,
  code: string,
): Promise<string> {
  switch (language) {
    case "bash":
      return execCommand(ctx, code);
    case "python": {
      const path = `/tmp/agent_${rand()}.py`;
      await ctx.sandbox.fs.uploadFile(Buffer.from(code, "utf8"), path);
      return execCommand(ctx, `python3 ${path}`);
    }
    case "javascript":
    case "typescript": {
      const ext = language === "typescript" ? "ts" : "mjs";
      const path = `/tmp/agent_${rand()}.${ext}`;
      await ctx.sandbox.fs.uploadFile(Buffer.from(code, "utf8"), path);
      return execCommand(ctx, `bun run ${path}`);
    }
    default:
      return `Unsupported language: ${language}`;
  }
}

function rand(): string {
  return Math.random().toString(36).slice(2, 10);
}
