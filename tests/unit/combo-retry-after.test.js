import { describe, expect, it, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

function failing(status, retryAfterSec) {
  const headers = { "Content-Type": "application/json" };
  if (retryAfterSec) headers["Retry-After"] = String(retryAfterSec);
  return new Response(JSON.stringify({ error: { message: "rate limited" } }), { status, headers });
}

describe("combo Retry-After", () => {
  it("forwards the earliest Retry-After when every model fails", async () => {
    const byModel = { "cc/a": failing(429, 90), "cx/b": failing(429, 30), "gcli/c": failing(503) };
    const res = await handleComboChat({
      body: { messages: [] },
      models: Object.keys(byModel),
      handleSingleModel: async (_body, model) => byModel[model],
      log,
      autoSwitch: false,
    });
    expect(res.status).toBe(429);
    const header = Number(res.headers.get("Retry-After"));
    expect(header).toBeGreaterThan(25);
    expect(header).toBeLessThanOrEqual(31);
  });

  it("sends no Retry-After when no model gave one", async () => {
    const res = await handleComboChat({
      body: { messages: [] },
      models: ["cc/a", "cx/b"],
      handleSingleModel: async () => failing(402),
      log,
      autoSwitch: false,
    });
    expect(res.status).toBe(402);
    expect(res.headers.get("Retry-After")).toBeNull();
  });

  it("still tries the next model after a billing error", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: { messages: [] },
      models: ["gcli/a", "cc/b"],
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        return model === "gcli/a" ? failing(402) : new Response("{}", { status: 200 });
      },
      log,
      autoSwitch: false,
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["gcli/a", "cc/b"]);
  });
});
