// Claude Code may send experimental top-level fields Anthropic rejects with
// 400 "safeguards: Extra inputs are not permitted". Strip them on passthrough.
import { describe, it, expect } from "vitest";
import { normalizeClaudePassthrough } from "../../open-sse/translator/formats/claude.js";

describe("normalizeClaudePassthrough — safeguards", () => {
  it("strips top-level safeguards so Anthropic does not 400", () => {
    const body = {
      model: "claude-opus-5-5",
      safeguards: { something: true },
      messages: [{ role: "user", content: "hi" }],
    };
    const out = normalizeClaudePassthrough(body, "claude-opus-5-5");
    expect(out.safeguards).toBeUndefined();
    expect(out.messages).toHaveLength(1);
  });
});
