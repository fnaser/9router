# fnaser/9router

A fork of [decolua/9router](https://github.com/decolua/9router) for running Claude, Codex, Cursor and Grok/xAI subscriptions behind one local endpoint.

## What differs from upstream

- **Utilization gate.** Before a combo sends a request, it skips a model when every active account for that provider is at its cap: 95% used on a session or weekly window (including Weekly SuperGrok), or 25% spent on a credit-only account. Per-model meters (Claude `weekly opus (7d)`, Codex Spark) only count for that model. A missing, failed or slow usage read still sends the request. Claude Team `extra_usage` maps to an `On-demand` row: when weekly/session is full but extra spend is still under 25%, the account stays eligible. Cursor reports a `Billing period` meter (95% skip) from `GetCurrentPeriodUsage`.
- **Usage last-good.** The combo utilization probe keeps the last successful quota snapshot for up to 15 minutes. A timed-out or soft-failed Anthropic/Cursor usage read reuses that snapshot instead of failing open and re-hitting a near-cap account.
- **Retry-After and billing errors.** An upstream cooldown is forwarded as `Retry-After`, including through combos. A billing error (HTTP 402, or a 429 whose body says the balance is empty) does not enter the 429 backoff ladder, and the combo moves on to the next model.
- **Claude `safeguards` / connect-timeout.** Claude Code sometimes sends a `safeguards` field that Anthropic rejects as “Extra inputs are not permitted”; the translator strips it so the combo can fall through. Synthetic `fetch connect timeout` 502s do **not** enter the 502 retry ladder (one attempt, default 15s headers wait) and take a **10s soft cool** so parallel turns skip the hung account without a 30s cascade lock.
- **Cursor sessions.** Import probes the live DashboardService API (revoked tokens fail import / Test Connection). Re-importing the same `machineId` updates that row; a second Cursor user on the same Mac warns that Cursor only keeps one live session per machine.
- **Local-only defaults.** `npm start` listens on `127.0.0.1` only, and the data directory is created owner-only (`0700`), since it holds provider tokens.
- **Token refresh at boot.** Proactive OAuth refresh starts when the server starts. Upstream starts it only once the dashboard is opened.
- **Empty-stream combo failover.** A streaming HTTP 200 that closes with only keepalives / zero usable frames falls through to the next combo model instead of returning an empty answer to the client (upstream issue [#3463](https://github.com/decolua/9router/issues/3463) / PR [#3560](https://github.com/decolua/9router/pull/3560)).
- **Slim dashboard.** Sidebar keeps Endpoint / Providers / Combos / Usage / Quota (+ Profile). Token Saver, CLI Tools, Media, Proxy Pools, Skills, and Console are commented out. OAuth Providers pins `claude` / `codex` / `cursor` / `xai` first.
- **MITM hard-skip.** Even if settings say MITM is on, auto-start requires `FORK_ENABLE_MITM=1`. Leave it unset.

## Set up on a new machine

Needs git and Node 22.5 or newer, for the built-in `node:sqlite`.

```bash
git clone https://github.com/fnaser/9router.git ~/9router
cd ~/9router
npm install
npm run build
npm start
```

Then, at http://127.0.0.1:20127/dashboard:

1. Log in with `123456` and change the password right away. Until you do, any program on the machine can log in.
2. **Providers:** connect Claude Code, Codex, Cursor (import from the IDE), and Grok/xAI. Logins do not travel with the repo. They live in `~/.9router` on each machine, so connect them again rather than copying that directory around.
3. **Endpoint:** create an API key. Chat requests need one, even from localhost.
4. **Combos:** create a combo, for example `subs`, with Claude first, then Codex, then Cursor, then Grok. Pick model ids from `curl http://127.0.0.1:20127/v1/models`.

Leave tunnels, Tailscale and the MITM proxy off in settings. They expose the dashboard or install a local certificate authority. MITM will not auto-start on this fork unless `FORK_ENABLE_MITM=1`. Optional: `MODEL_CATALOG_SYNC=off` skips the half-meg catalog refresh you do not need for four providers.

### Personal vs company accounts

Mark each connection in **Providers → Edit → Account tier** (`personal` or `company`). Stored as `providerSpecificData.tier`. Name prefixes `[personal]` / `[company]` still work as a fallback. Untagged → personal.

A future content classifier will prefer `company` accounts for sensitive prompts.

## Use it

Claude Code in a terminal (or a `claude9` wrapper that sources `~/.9router/claude-env.sh`):

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:20127 ANTHROPIC_AUTH_TOKEN=YOUR_KEY claude --model subs
```

Any OpenAI-compatible client: base URL `http://127.0.0.1:20127/v1`, your key, and the combo name as the model.

Claude Desktop: Help → Troubleshooting → Enable Developer Mode, then Developer → Configure Third-Party Inference…. Set provider `gateway`, base URL `http://127.0.0.1:20127/v1`, your key, and list the combo name under models. This switches the app off your Anthropic account and keeps history on the machine. Prefer this window over the "Claude Cowork" card in 9router's CLI Tools page, which also loosens Desktop's security settings.

## Keep it running (macOS)

Start it at login and restart it if it exits:

```bash
cd ~/9router
cat > ~/Library/LaunchAgents/com.fnaser.9router.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.fnaser.9router</string>
  <key>WorkingDirectory</key><string>$PWD</string>
  <key>ProgramArguments</key>
  <array>
    <string>$(command -v node)</string>
    <string>custom-server.js</string>
    <string>--port</string><string>20127</string>
    <string>--hostname</string><string>127.0.0.1</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict><key>NODE_ENV</key><string>production</string></dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/.9router/logs/server.log</string>
  <key>StandardErrorPath</key><string>$HOME/.9router/logs/server.log</string>
</dict>
</plist>
EOF
mkdir -p ~/.9router/logs
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.fnaser.9router.plist
```

Stop it with `launchctl bootout gui/$(id -u)/com.fnaser.9router`. After pulling changes, run `npm install && npm run build`, then restart it with `launchctl kickstart -k gui/$(id -u)/com.fnaser.9router`.

## Update from upstream

```bash
git remote add upstream https://github.com/decolua/9router.git   # once
git fetch upstream
git merge upstream/master
npm run test:fork
```

`test:fork` runs the vitest subset that guards this path (utilization gate / last-good / warm path, Cursor usage, Retry-After / billing / safeguards, connection tier, empty-stream failover). Equivalent manual list:

```bash
cd tests && npm install && npx vitest run \
  unit/utilization-gate.test.js \
  unit/utilization-skip-last-good.test.js \
  unit/utilization-skip-warm-path.test.js \
  unit/cursor-usage.test.js \
  unit/combo-retry-after.test.js \
  unit/retry-after-backoff.test.js \
  unit/glm-error-classification.test.js \
  unit/upstream-retry-after.test.js \
  unit/account-fallback-4xx.test.js \
  unit/claude-passthrough-safeguards.test.js \
  unit/connection-tier.test.js \
  unit/combo-empty-stream-3463.test.js
```

Conflicts usually land in `open-sse/services/combo.js`, `src/sse/handlers/chat.js`, `open-sse/handlers/chatCore.js` and `open-sse/utils/error.js`. If upstream re-adds a background refresh start in `custom-server.js` or `initializeApp.js`, drop it: `src/instrumentation.js` is the only place that should start it.

The full suite has about 74 known failures. Most are in providers this fork does not run day-to-day (Kiro, OpenCode, Kimchi, Cline, Windsurf, Antigravity, Zed). Cursor is in the usage path here; `oauth-cursor-auto-import` remains a known-fail *test*, not an unused provider. The rest are features upstream has turned off (search-aware combo reordering), tests that rely on a missing `cloud/` directory or a live endpoint, and translator strictness upstream never shipped, such as flattening text arrays to plain strings, which OpenAI-compatible upstreams accept either way. `db-concurrent` fails because usage logging drops a row identical to one in the same millisecond, and the test sends 100 identical rows at once. Compare against a run on the previous commit rather than expecting all green. If `golden-url-header` fails after a merge, check that the URL or header change is intended, then refresh the snapshot with `npx vitest run translator/golden-url-header.test.js -u`.
