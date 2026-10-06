/**
 * Optional local PII gate client. Fail-open: any error / timeout → no tier force.
 *
 * Env:
 *   FORK_PII_GATE_URL   e.g. http://127.0.0.1:20129/classify  (unset = disabled)
 *   FORK_PII_GATE_TIMEOUT_MS  default 800
 */

const DEFAULT_TIMEOUT_MS = 800;
const MAX_CHARS = 2_000;

function envUrl() {
  return (process.env.FORK_PII_GATE_URL || "").trim();
}

function timeoutMs() {
  const n = Number(process.env.FORK_PII_GATE_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

/** Pull a short text head from OpenAI / Claude / Responses-shaped bodies. */
export function extractPiiGateText(body) {
  if (!body || typeof body !== "object") return "";
  const parts = [];

  if (typeof body.system === "string" && body.system.trim()) {
    parts.push(body.system.trim());
  } else if (Array.isArray(body.system)) {
    for (const block of body.system) {
      if (typeof block === "string") parts.push(block);
      else if (block?.type === "text" && block.text) parts.push(String(block.text));
    }
  }

  const messages = Array.isArray(body.messages)
    ? body.messages
    : Array.isArray(body.input)
      ? body.input
      : [];

  // Prefer last user turn; fall back to last message with text.
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    const role = m?.role || m?.type;
    if (role !== "user" && role !== "message") continue;
    const text = messageToPlainText(m);
    if (text) {
      parts.push(text);
      break;
    }
  }

  if (parts.length === 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = messageToPlainText(messages[i]);
      if (text) {
        parts.push(text);
        break;
      }
    }
  }

  return parts.join("\n\n").slice(0, MAX_CHARS);
}

function messageToPlainText(m) {
  if (!m) return "";
  const c = m.content ?? m.text ?? m.input_text;
  if (typeof c === "string") return c.trim();
  if (!Array.isArray(c)) return "";
  return c
    .map((block) => {
      if (typeof block === "string") return block;
      if (block?.type === "text" || block?.type === "input_text") return block.text || "";
      // Skip tool_result / images — high false-positive rate for PII in dumps.
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

/**
 * @returns {Promise<{ sensitive: boolean, types?: string[] }|null>}
 */
export async function probePiiGate(body, { fetchImpl = fetch, log } = {}) {
  const url = envUrl();
  if (!url) return null;

  const text = extractPiiGateText(body);
  if (!text.trim()) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs());
  timer.unref?.();

  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      log?.warn?.("PII_GATE", `gate HTTP ${res.status} — fail-open`);
      return null;
    }
    const json = await res.json();
    const sensitive = json?.sensitive === true || (Array.isArray(json?.spans) && json.spans.length > 0);
    const types = Array.isArray(json?.types)
      ? json.types.map(String)
      : Array.isArray(json?.spans)
        ? [...new Set(json.spans.map((s) => s?.type).filter(Boolean))]
        : [];
    return { sensitive: !!sensitive, types };
  } catch (err) {
    log?.warn?.("PII_GATE", `gate error — fail-open: ${err?.message || err}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}
