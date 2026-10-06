import { describe, expect, it, vi, afterEach } from "vitest";
import { extractPiiGateText, probePiiGate } from "../../src/sse/services/piiGate.js";

describe("piiGate", () => {
  afterEach(() => {
    delete process.env.FORK_PII_GATE_URL;
    delete process.env.FORK_PII_GATE_TIMEOUT_MS;
  });

  it("extracts system + last user text and skips tool_result blocks", () => {
    const text = extractPiiGateText({
      system: "You are helpful.",
      messages: [
        { role: "user", content: "earlier" },
        {
          role: "user",
          content: [
            { type: "text", text: "Email me at jane@acme.com" },
            { type: "tool_result", content: "secret should be ignored" },
          ],
        },
      ],
    });
    expect(text).toContain("You are helpful.");
    expect(text).toContain("jane@acme.com");
    expect(text).not.toContain("secret should be ignored");
  });

  it("probePiiGate is a no-op when URL unset", async () => {
    const fetchImpl = vi.fn();
    expect(await probePiiGate({ messages: [{ role: "user", content: "hi" }] }, { fetchImpl })).toBe(null);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("probePiiGate maps spans to sensitive", async () => {
    process.env.FORK_PII_GATE_URL = "http://127.0.0.1:20129/classify";
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        sensitive: true,
        types: ["contact.email"],
        spans: [{ type: "contact.email", text: "a@b.c" }],
      }),
    }));
    const out = await probePiiGate(
      { messages: [{ role: "user", content: "a@b.c" }] },
      { fetchImpl }
    );
    expect(out).toEqual({ sensitive: true, types: ["contact.email"] });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("probePiiGate fails open on network error", async () => {
    process.env.FORK_PII_GATE_URL = "http://127.0.0.1:20129/classify";
    const fetchImpl = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const log = { warn: vi.fn() };
    expect(
      await probePiiGate({ messages: [{ role: "user", content: "hi" }] }, { fetchImpl, log })
    ).toBe(null);
    expect(log.warn).toHaveBeenCalled();
  });
});
