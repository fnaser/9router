import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/localDb", () => ({
  getProviderConnections: vi.fn(),
}));

vi.mock("open-sse/services/usage.js", () => ({
  getUsageForProvider: vi.fn(),
}));

vi.mock("../../src/sse/services/tokenRefresh.js", () => ({
  checkAndRefreshToken: vi.fn(async (_p, c) => c),
}));

vi.mock("@/lib/network/connectionProxy", () => ({
  resolveConnectionProxyConfig: vi.fn(async () => ({})),
}));

import { getProviderConnections } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import {
  _resetUtilizationSkipCacheForTests,
  _rememberUsageForTests,
  _peekUsageForTests,
  shouldSkipComboModel,
} from "../../src/sse/services/utilizationSkip.js";

describe("utilizationSkip warm path", () => {
  beforeEach(() => {
    _resetUtilizationSkipCacheForTests();
    vi.clearAllMocks();
  });

  it("peeks short-cache quotas without needing refresh", () => {
    _rememberUsageForTests("a1", { quotas: { "weekly (7d)": { used: 10, total: 100 } } });
    const peek = _peekUsageForTests({ id: "a1" });
    expect(peek.usage.quotas["weekly (7d)"].used).toBe(10);
    expect(peek.needsRefresh).toBe(false);
  });

  it("decides under-cap from warm cache without calling getUsageForProvider", async () => {
    getProviderConnections.mockResolvedValue([{ id: "a1", provider: "claude", isActive: true }]);
    _rememberUsageForTests("a1", { quotas: { "weekly (7d)": { used: 10, total: 100 } } });

    const skip = await shouldSkipComboModel("cc/claude-opus-4-6");
    expect(skip).toBe(false);
    expect(getUsageForProvider).not.toHaveBeenCalled();
  });

  it("skips from warm last-good when every account is at cap", async () => {
    getProviderConnections.mockResolvedValue([{ id: "a1", provider: "claude", isActive: true }]);
    _rememberUsageForTests("a1", { quotas: { "weekly (7d)": { used: 97, total: 100 } } });

    const skip = await shouldSkipComboModel("cc/claude-opus-4-6");
    expect(skip).toBe(true);
    expect(getUsageForProvider).not.toHaveBeenCalled();
  });

  it("falls back to network when no warm snapshot exists", async () => {
    getProviderConnections.mockResolvedValue([{ id: "a1", provider: "claude", isActive: true, accessToken: "t" }]);
    getUsageForProvider.mockResolvedValue({ quotas: { "weekly (7d)": { used: 10, total: 100 } } });

    const skip = await shouldSkipComboModel("cc/claude-opus-4-6");
    expect(skip).toBe(false);
    expect(getUsageForProvider).toHaveBeenCalled();
  });
});
