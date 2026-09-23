import { describe, expect, it } from "vitest";

import {
  evaluateComboModelSkip,
  isAccountAtUtilizationCap,
  shouldSkipModelForUtilization,
} from "../../open-sse/services/utilizationGate.js";

describe("utilization gate", () => {
  it("keeps an account under 95%", () => {
    expect(isAccountAtUtilizationCap({
      "session (5h)": { used: 94, total: 100, unlimited: false },
    })).toBe(false);
  });

  it("flags an account when any capped window is at 95%", () => {
    expect(isAccountAtUtilizationCap({
      "session (5h)": { used: 10, total: 100, unlimited: false },
      "weekly (7d)": { used: 95, total: 100, unlimited: false },
    })).toBe(true);
  });

  it("ignores unlimited windows and balance-only pots", () => {
    expect(isAccountAtUtilizationCap({
      included: { used: 100, total: 100, unlimited: true },
      Prepaid: { used: 0, total: 40, remainingPercentage: 100, unlimited: false },
    })).toBe(false);
  });

  it("flags a credit-only account once 25% of a known cap is spent", () => {
    expect(isAccountAtUtilizationCap({
      "On-demand": { used: 25, total: 100, unlimited: false },
    })).toBe(true);
    expect(isAccountAtUtilizationCap({
      "Monthly included": { used: 24, total: 100, unlimited: false },
    })).toBe(false);
  });

  it("does not let a credit line skip a subscription that is still under 95%", () => {
    expect(isAccountAtUtilizationCap({
      "Weekly SuperGrok": { used: 10, total: 100, unlimited: false },
      "On-demand": { used: 40, total: 100, unlimited: false },
    })).toBe(false);
  });

  it("skips a combo model only when every account is at the cap", () => {
    const full = { weekly: { used: 96, total: 100, unlimited: false } };
    const open = { weekly: { used: 40, total: 100, unlimited: false } };
    expect(shouldSkipModelForUtilization([full, full])).toBe(true);
    expect(shouldSkipModelForUtilization([full, open])).toBe(false);
    expect(shouldSkipModelForUtilization([])).toBe(false);
  });

  it("keeps the model when usage cannot be read", async () => {
    const deps = {
      parseModel: () => ({ provider: "claude" }),
      getConnections: async () => [{ id: "a" }],
      getUsage: async () => ({ message: "unavailable" }),
    };
    expect(await evaluateComboModelSkip("cc/claude-opus", deps)).toBe(false);
  });

  it("skips when the only account snapshot is at the cap", async () => {
    const deps = {
      parseModel: () => ({ provider: "claude" }),
      getConnections: async () => [{ id: "a" }],
      getUsage: async () => ({ quotas: { "session (5h)": { used: 97, total: 100 } } }),
    };
    expect(await evaluateComboModelSkip("cc/claude-opus", deps)).toBe(true);
  });
});
