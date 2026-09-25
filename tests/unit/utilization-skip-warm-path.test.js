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
  beforeEach(async () => {
    _resetUtilizationSkipCacheForTests();
    vi.clearAllMocks();
    const { _resetProviderCircuitForTests } = await import("../../src/sse/services/providerCircuit.js");
    _resetProviderCircuitForTests();
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
    expect(skip).toBe("utilization cap");
    expect(getUsageForProvider).not.toHaveBeenCalled();
  });

  it("falls back to network when no warm snapshot exists", async () => {
    getProviderConnections.mockResolvedValue([{ id: "a1", provider: "claude", isActive: true, accessToken: "t" }]);
    getUsageForProvider.mockResolvedValue({ quotas: { "weekly (7d)": { used: 10, total: 100 } } });

    const skip = await shouldSkipComboModel("cc/claude-opus-4-6");
    expect(skip).toBe(false);
    expect(getUsageForProvider).toHaveBeenCalled();
  });

  it("reports connection circuit when every active connection is tripped", async () => {
    const { tripConnection, _resetProviderCircuitForTests } = await import("../../src/sse/services/providerCircuit.js");
    _resetProviderCircuitForTests();
    tripConnection("a1", 60_000);
    getProviderConnections.mockResolvedValue([{ id: "a1", provider: "claude", isActive: true }]);

    const skip = await shouldSkipComboModel("cc/claude-opus-4-6");
    expect(skip).toEqual({ reason: "connection circuit", retryAfterMs: expect.any(Number) });
    expect(skip.retryAfterMs).toBeGreaterThan(50_000);
    expect(getUsageForProvider).not.toHaveBeenCalled();
    _resetProviderCircuitForTests();
  });

  it("does not skip for circuit when a sibling connection is still healthy", async () => {
    const { tripConnection, _resetProviderCircuitForTests } = await import("../../src/sse/services/providerCircuit.js");
    _resetProviderCircuitForTests();
    tripConnection("a1", 60_000);
    getProviderConnections.mockResolvedValue([
      { id: "a1", provider: "claude", isActive: true },
      { id: "a2", provider: "claude", isActive: true },
    ]);
    _rememberUsageForTests("a1", { quotas: { "weekly (7d)": { used: 10, total: 100 } } });
    _rememberUsageForTests("a2", { quotas: { "weekly (7d)": { used: 10, total: 100 } } });

    const skip = await shouldSkipComboModel("cc/claude-opus-4-6");
    expect(skip).toBe(false);
    _resetProviderCircuitForTests();
  });

  it("reports model locked with Retry-After when every account has an active lock", async () => {
    const until = new Date(Date.now() + 60_000).toISOString();
    getProviderConnections.mockResolvedValue([{
      id: "a1",
      provider: "claude",
      isActive: true,
      "modelLock_claude-opus-4-6": until,
    }]);

    const skip = await shouldSkipComboModel("cc/claude-opus-4-6");
    expect(skip).toEqual({ reason: "model locked", retryAfterMs: expect.any(Number) });
    expect(skip.retryAfterMs).toBeGreaterThan(50_000);
    expect(skip.retryAfterMs).toBeLessThanOrEqual(60_000);
    expect(getUsageForProvider).not.toHaveBeenCalled();
  });

  it("uses the earliest lock among accounts for Retry-After", async () => {
    getProviderConnections.mockResolvedValue([
      {
        id: "a1",
        provider: "claude",
        isActive: true,
        "modelLock_claude-opus-4-6": new Date(Date.now() + 40_000).toISOString(),
      },
      {
        id: "a2",
        provider: "claude",
        isActive: true,
        "modelLock_claude-opus-4-6": new Date(Date.now() + 15_000).toISOString(),
      },
    ]);

    const skip = await shouldSkipComboModel("cc/claude-opus-4-6");
    expect(skip.reason).toBe("model locked");
    expect(skip.retryAfterMs).toBeGreaterThan(10_000);
    expect(skip.retryAfterMs).toBeLessThanOrEqual(15_000);
  });
});
