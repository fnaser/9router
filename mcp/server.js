#!/usr/bin/env node
/**
 * 9router MCP server — expose subscription models as tools for Codex / Claude Code / Cursor.
 *
 * Env (optional; key also loaded from ~/.9router/claude-env.sh):
 *   NINEROUTER_BASE_URL   default http://127.0.0.1:20127
 *   NINEROUTER_API_KEY    or ANTHROPIC_AUTH_TOKEN
 *   NINEROUTER_MCP_DEFAULT_MODEL  default cc/claude-opus-5-5
 */

import { readFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

const DEFAULT_BASE = "http://127.0.0.1:20127";
const DEFAULT_MODEL = "cc/claude-opus-5-5";
const REQUEST_TIMEOUT_MS = Number(process.env.NINEROUTER_MCP_TIMEOUT_MS) || 180_000;

function loadKeyFromClaudeEnv() {
  const path = join(homedir(), ".9router", "claude-env.sh");
  if (!existsSync(path)) return "";
  try {
    const text = readFileSync(path, "utf8");
    const m = text.match(/^\s*export\s+ANTHROPIC_AUTH_TOKEN=["']?([^"'\n]+)["']?/m);
    return m?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

function config() {
  const baseUrl = (process.env.NINEROUTER_BASE_URL || DEFAULT_BASE).replace(/\/$/, "");
  const apiKey =
    process.env.NINEROUTER_API_KEY ||
    process.env.ANTHROPIC_AUTH_TOKEN ||
    loadKeyFromClaudeEnv();
  const defaultModel = process.env.NINEROUTER_MCP_DEFAULT_MODEL || DEFAULT_MODEL;
  if (!apiKey) {
    throw new Error(
      "No API key: set NINEROUTER_API_KEY or ANTHROPIC_AUTH_TOKEN, or put it in ~/.9router/claude-env.sh"
    );
  }
  return { baseUrl, apiKey, defaultModel };
}

async function gatewayFetch(path, { method = "GET", body } = {}) {
  const { baseUrl, apiKey } = config();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("9router MCP request timeout")), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) {
      const msg =
        json?.error?.message ||
        json?.error ||
        text.slice(0, 500) ||
        `HTTP ${res.status}`;
      const err = new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
      err.status = res.status;
      err.retryAfter = res.headers.get("Retry-After");
      throw err;
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

function extractAssistantText(completion) {
  const choice = completion?.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : part?.text || ""))
      .filter(Boolean)
      .join("\n");
  }
  if (completion?.content && Array.isArray(completion.content)) {
    return completion.content
      .filter((b) => b?.type === "text")
      .map((b) => b.text)
      .join("\n");
  }
  return JSON.stringify(completion, null, 2);
}

async function chatComplete({ model, system, task, context, maxTokens }) {
  const messages = [];
  if (system) messages.push({ role: "system", content: system });
  const userParts = [`# Task\n${task}`];
  if (context) userParts.push(`# Context\n${context}`);
  messages.push({ role: "user", content: userParts.join("\n\n") });

  const body = {
    model,
    messages,
    stream: false,
  };
  if (maxTokens != null) body.max_tokens = maxTokens;

  const completion = await gatewayFetch("/v1/chat/completions", { method: "POST", body });
  return {
    model: completion?.model || model,
    text: extractAssistantText(completion),
    usage: completion?.usage || null,
  };
}

function toolError(err) {
  const bits = [err?.message || String(err)];
  if (err?.status) bits.push(`(HTTP ${err.status})`);
  if (err?.retryAfter) bits.push(`Retry-After: ${err.retryAfter}s`);
  return {
    isError: true,
    content: [{ type: "text", text: bits.join(" ") }],
  };
}

const server = new McpServer({
  name: "9router",
  version: "0.1.0",
});

server.registerTool(
  "list_models",
  {
    title: "List 9router models",
    description:
      "List models and combos available on the local 9router gateway (subscription routes such as cc/…, cx/…, cu/…, xai/…, and combo names like subs).",
    inputSchema: {},
  },
  async () => {
    try {
      const data = await gatewayFetch("/v1/models");
      const ids = (data?.data || []).map((m) => m.id).filter(Boolean);
      const text = ids.length
        ? ids.join("\n")
        : JSON.stringify(data, null, 2);
      return { content: [{ type: "text", text }] };
    } catch (err) {
      return toolError(err);
    }
  }
);

server.registerTool(
  "delegate",
  {
    title: "Delegate task to a 9router model",
    description:
      "Send a focused implementation or analysis task to a model behind local 9router (uses your connected subscriptions until usage limits). Prefer cc/claude-opus-5-5 for Claude Opus work, or subs for Claude→Codex→Cursor→xAI fallthrough. Returns the assistant text only — keep task+context tight.",
    inputSchema: {
      task: z
        .string()
        .describe("What the sub-agent should do (acceptance criteria, files, constraints)."),
      model: z
        .string()
        .optional()
        .describe(
          `9router model id (default ${DEFAULT_MODEL}). Examples: cc/claude-opus-5-5, subs, cx/gpt-5.3-codex.`
        ),
      context: z
        .string()
        .optional()
        .describe("Optional snippets: file contents, diffs, errors — not the whole chat history."),
      system: z
        .string()
        .optional()
        .describe("Optional system prompt override for the sub-agent."),
      max_tokens: z
        .number()
        .int()
        .positive()
        .optional()
        .describe("Optional max output tokens."),
    },
  },
  async ({ task, model, context, system, max_tokens }) => {
    try {
      const { defaultModel } = config();
      const result = await chatComplete({
        model: model || defaultModel,
        system:
          system ||
          "You are a focused coding sub-agent. Return concrete results: code, diffs, or a short plan. No filler.",
        task,
        context,
        maxTokens: max_tokens,
      });
      const header = `model=${result.model}`;
      const usage = result.usage
        ? ` usage=${JSON.stringify(result.usage)}`
        : "";
      return {
        content: [
          {
            type: "text",
            text: `${header}${usage}\n\n${result.text}`,
          },
        ],
      };
    } catch (err) {
      return toolError(err);
    }
  }
);

server.registerTool(
  "ask_claude",
  {
    title: "Ask Claude via 9router",
    description:
      "Convenience wrapper for delegate() with model cc/claude-opus-5-5 (override with NINEROUTER_MCP_DEFAULT_MODEL or pass model on delegate). Use from Codex when you want Claude Opus to implement a step.",
    inputSchema: {
      task: z.string().describe("Task for Claude."),
      context: z.string().optional().describe("Optional supporting context."),
    },
  },
  async ({ task, context }) => {
    try {
      const { defaultModel } = config();
      // Prefer Claude subscription id; fall back to configured default if renamed.
      const model =
        process.env.NINEROUTER_MCP_CLAUDE_MODEL ||
        (defaultModel.startsWith("cc/") ? defaultModel : "cc/claude-opus-5-5");
      const result = await chatComplete({
        model,
        system:
          "You are Claude acting as a coding sub-agent for another agent. Return concrete code or diffs.",
        task,
        context,
      });
      return {
        content: [
          {
            type: "text",
            text: `model=${result.model}\n\n${result.text}`,
          },
        ],
      };
    } catch (err) {
      return toolError(err);
    }
  }
);

async function main() {
  // Touch config early so missing keys fail at startup with a clear stderr message.
  try {
    config();
  } catch (err) {
    console.error(`[9router-mcp] ${err.message}`);
    process.exit(1);
  }
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("[9router-mcp] ready (stdio)");
}

main().catch((err) => {
  console.error("[9router-mcp] fatal:", err);
  process.exit(1);
});
