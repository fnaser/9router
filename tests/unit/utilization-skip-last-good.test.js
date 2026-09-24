import { describe, it, expect, beforeEach } from "vitest";

import {
  _resetUtilizationSkipCacheForTests,
  _rememberUsageForTests,
  _lastGoodOrUnavailableForTests,
} from "../../src/sse/services/utilizationSkip.js";

describe("utilizationSkip last-good", () => {
  beforeEach(() => {
    _resetUtilizationSkipCacheForTests();
  });

  it("returns last-good quotas within 15 minutes", () => {
    const usage = { quotas: { "weekly (7d)": { used: 97, total: 100 } } };
    _rememberUsageForTests("acct-1", usage);
    expect(_lastGoodOrUnavailableForTests("acct-1")).toEqual(usage);
  });

  it("does not remember soft failures as last-good", () => {
    _rememberUsageForTests("acct-1", { quotas: { weekly: { used: 10, total: 100 } } });
    _rememberUsageForTests("acct-1", null);
    // Failure wipe of the short cache must not erase last-good.
    expect(_lastGoodOrUnavailableForTests("acct-1").quotas.weekly.used).toBe(10);
  });

  it("falls back to unavailable when nothing was remembered", () => {
    expect(_lastGoodOrUnavailableForTests("missing")).toEqual({ message: "usage unavailable" });
  });
});
