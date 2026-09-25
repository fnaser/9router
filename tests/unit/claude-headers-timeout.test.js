import { describe, expect, it } from "vitest";
import { PROVIDERS } from "../../open-sse/providers/index.js";

describe("claude transport timeout", () => {
  it("waits 60s for response headers (TTFT), not the global 15s default", () => {
    expect(PROVIDERS.claude.timeoutMs).toBe(60_000);
  });
});
