import { describe, expect, it, vi } from "vitest";

import { handleComboChat } from "../../open-sse/services/combo.js";

const log = { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() };

function failing(status, message = "rate limited") {
  return new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function ok() {
  return new Response(JSON.stringify({ choices: [{ message: { content: "hi" } }] }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

describe("combo wrap-once after full fallthrough", () => {
  it("retries from the top once when every model failed on the first pass", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: { messages: [] },
      models: ["cc/a", "cx/b"],
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        if (model === "cc/a" && calls.filter((m) => m === "cc/a").length === 2) return ok();
        return failing(429);
      },
      log,
      autoSwitch: false,
    });
    expect(res.status).toBe(200);
    expect(calls).toEqual(["cc/a", "cx/b", "cc/a"]);
  });

  it("stops after the second pass when everything still fails", async () => {
    const calls = [];
    const res = await handleComboChat({
      body: { messages: [] },
      models: ["cc/a", "cx/b"],
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        return failing(402, "out of credits");
      },
      log,
      autoSwitch: false,
    });
    expect(res.status).toBe(402);
    expect(calls).toEqual(["cc/a", "cx/b", "cc/a", "cx/b"]);
  });

  it("honors shouldSkipModel on the wrap pass", async () => {
    const calls = [];
    const skip = new Set(["cc/a"]);
    const res = await handleComboChat({
      body: { messages: [] },
      models: ["cc/a", "cx/b"],
      shouldSkipModel: async (model) => skip.has(model),
      handleSingleModel: async (_body, model) => {
        calls.push(model);
        if (model === "cx/b" && calls.length === 1) {
          skip.delete("cc/a"); // unlock first model for the wrap
          return failing(503);
        }
        if (model === "cc/a") return ok();
        return failing(503);
      },
      log,
      autoSwitch: false,
    });
    expect(res.status).toBe(200);
    // Pass 1: skip a, try b (fail). Pass 2: try a (ok) — b never needed.
    expect(calls).toEqual(["cx/b", "cc/a"]);
  });
});
