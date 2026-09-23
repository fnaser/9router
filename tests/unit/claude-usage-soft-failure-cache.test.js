import { beforeEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  default: fetchMock,
  proxyAwareFetch: fetchMock,
}));

const { getClaudeUsage } = await import("../../open-sse/services/usage/claude.js");

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

beforeEach(() => {
  fetchMock.mockReset();
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

describe("Claude usage cache after a failed read", () => {
  it("fetches again instead of replaying the failed read forever", async () => {
    fetchMock.mockResolvedValue(json(500, {}));
    const first = await getClaudeUsage("token-soft-fail");
    expect(first.quotas).toBeUndefined();
    const callsAfterFirst = fetchMock.mock.calls.length;

    fetchMock.mockResolvedValue(json(200, { five_hour: { utilization: 10, resets_at: null } }));
    const second = await getClaudeUsage("token-soft-fail");

    expect(fetchMock.mock.calls.length).toBeGreaterThan(callsAfterFirst);
    expect(second.quotas["session (5h)"].used).toBe(10);
  });
});
