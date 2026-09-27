# 9router MCP (subscription delegate)

Local **stdio MCP server** so Codex Desktop / Claude Code / Cursor can call your 9router subscriptions as sub-agents (e.g. Astra plans → `ask_claude` / `delegate` → Claude Opus via `cc/claude-opus-5-5` or combo `subs`).

## Tools

| Tool | Purpose |
|---|---|
| `list_models` | List gateway model / combo ids |
| `delegate` | Send `task` (+ optional `context`) to any 9router model (default `cc/claude-opus-5-5`) |
| `ask_claude` | Same as delegate pinned to Claude (`NINEROUTER_MCP_CLAUDE_MODEL` or `cc/claude-opus-5-5`) |

Usage limits still apply inside 9router (util skip, locks, circuit, combo fallthrough).

## Setup

```bash
cd ~/9router/mcp && npm install
```

Needs 9router running on `127.0.0.1:20127` and an API key in `~/.9router/claude-env.sh` (`ANTHROPIC_AUTH_TOKEN`) or `NINEROUTER_API_KEY`.

### Codex Desktop / CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.ninerouter]
command = "node"
args = ["/Users/YOU/9router/mcp/server.js"]
cwd = "/Users/YOU/9router/mcp"
startup_timeout_sec = 20
tool_timeout_sec = 300
```

Restart Codex (or reload MCP). In a session, ask it to use `ask_claude` / `delegate` for an implementation step.

### Claude Code (`~/.claude.json` mcpServers)

```json
{
  "mcpServers": {
    "ninerouter": {
      "command": "node",
      "args": ["/Users/YOU/9router/mcp/server.js"]
    }
  }
}
```

## Env

| Var | Default |
|---|---|
| `NINEROUTER_BASE_URL` | `http://127.0.0.1:20127` |
| `NINEROUTER_API_KEY` / `ANTHROPIC_AUTH_TOKEN` | from `~/.9router/claude-env.sh` |
| `NINEROUTER_MCP_DEFAULT_MODEL` | `cc/claude-opus-5-5` |
| `NINEROUTER_MCP_CLAUDE_MODEL` | same as ask_claude target |
| `NINEROUTER_MCP_TIMEOUT_MS` | `180000` |

## Smoke test

```bash
cd ~/9router/mcp
node --input-type=module -e '
import { spawn } from "node:child_process";
// Prefer a real MCP client; quick path: call gateway helpers by running list via curl
'
curl -s -H "Authorization: Bearer $ANTHROPIC_AUTH_TOKEN" http://127.0.0.1:20127/v1/models | head -c 200
```

Or from Codex: “Use the ninerouter ask_claude tool to explain what 2+2 is in one sentence.”
