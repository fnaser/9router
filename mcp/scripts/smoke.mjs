#!/usr/bin/env node
/** Smoke: list_models + tiny ask_claude via MCP stdio client. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));
const serverPath = join(root, "..", "server.js");

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [serverPath],
  cwd: join(root, ".."),
  stderr: "inherit",
});

const client = new Client({ name: "9router-mcp-smoke", version: "0.1.0" });
await client.connect(transport);

const tools = await client.listTools();
console.log(
  "tools:",
  tools.tools.map((t) => t.name).join(", ")
);

const listed = await client.callTool({ name: "list_models", arguments: {} });
const listText = listed.content?.map((c) => c.text).join("\n") || "";
console.log("list_models sample:\n", listText.split("\n").slice(0, 8).join("\n"));

const asked = await client.callTool({
  name: "ask_claude",
  arguments: {
    task: "Reply with exactly: ok",
  },
});
console.log("ask_claude:\n", asked.content?.map((c) => c.text).join("\n") || asked);

await client.close();
process.exit(asked.isError ? 1 : 0);
