# fnaser/9router

A fork of [decolua/9router](https://github.com/decolua/9router) for running Claude, Codex and Grok Build subscriptions behind one local endpoint.

## What differs from upstream

- **Utilization gate.** Before a combo sends a request, it skips a model when every active account for that provider is at its cap: 95% used on a session or weekly window (including Weekly SuperGrok), or 25% spent on a credit-only account. Per-model meters (Claude `weekly opus (7d)`, Codex Spark) only count for that model. A missing, failed or slow usage read still sends the request.
- **Retry-After and billing errors.** An upstream cooldown is forwarded as `Retry-After`, including through combos. A billing error (HTTP 402, or a 429 whose body says the balance is empty) does not enter the 429 backoff ladder, and the combo moves on to the next model.
- **Local-only defaults.** `npm start` listens on `127.0.0.1` only, and the data directory is created owner-only (`0700`), since it holds provider tokens.

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
2. **Providers:** connect Claude Code, Codex and Grok Build. Logins do not travel with the repo. They live in `~/.9router` on each machine, so connect them again rather than copying that directory around.
3. **Endpoint:** create an API key. Chat requests need one, even from localhost.
4. **Combos:** create a combo, for example `sub`, with Claude first, then Codex, then Grok. Pick model ids from `curl http://127.0.0.1:20127/v1/models`.

Leave tunnels, Tailscale and the MITM proxy off in settings. They expose the dashboard or install a local certificate authority.

## Use it

Claude Code in a terminal:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:20127 ANTHROPIC_AUTH_TOKEN=YOUR_KEY claude --model sub
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
cd tests && npm install && npx vitest run unit/utilization-gate.test.js unit/combo-retry-after.test.js unit/retry-after-backoff.test.js unit/glm-error-classification.test.js unit/upstream-retry-after.test.js
```

Conflicts usually land in `open-sse/services/combo.js`, `src/sse/handlers/chat.js`, `open-sse/handlers/chatCore.js` and `open-sse/utils/error.js`. The full suite has about 96 upstream failures on a plain checkout. Compare against a run on the previous commit rather than expecting all green.
