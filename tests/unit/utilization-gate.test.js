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

  it("does not let a Codex side meter skip the chat window", () => {
    expect(isAccountAtUtilizationCap({
      session: { used: 10, total: 100, unlimited: false },
      weekly: { used: 20, total: 100, unlimited: false },
      review_weekly: { used: 99, total: 100, unlimited: false },
      spark_session: { used: 100, total: 100, unlimited: false },
    })).toBe(false);
  });

  it("counts a Claude per-model weekly row only for that model", () => {
    const quotas = {
      "session (5h)": { used: 20, total: 100 },
      "weekly (7d)": { used: 30, total: 100 },
      "weekly opus (7d)": { used: 97, total: 100 },
    };
    expect(isAccountAtUtilizationCap(quotas, "claude-opus-4-6")).toBe(true);
    expect(isAccountAtUtilizationCap(quotas, "claude-sonnet-4-6")).toBe(false);
  });

  it("counts Codex Spark only for the Spark model and never counts review", () => {
    const quotas = {
      spark_session: { used: 99, total: 100 },
      review_weekly: { used: 100, total: 100 },
    };
    expect(isAccountAtUtilizationCap(quotas, "gpt-5.5-codex")).toBe(false);
    expect(isAccountAtUtilizationCap(quotas, "gpt-5.3-codex-spark")).toBe(true);
  });

  it("ignores a window whose reset time has passed", () => {
    const now = Date.parse("2026-09-23T10:00:00Z");
    expect(isAccountAtUtilizationCap({
      "session (5h)": { used: 99, total: 100, resetAt: "2026-09-23T09:00:00.000Z" },
    }, "claude-opus-4-6", now)).toBe(false);
    expect(isAccountAtUtilizationCap({
      "session (5h)": { used: 99, total: 100, resetAt: "2026-09-23T11:00:00.000Z" },
    }, "claude-opus-4-6", now)).toBe(true);
  });

  it("passes the combo model id through to the scoped rows", async () => {
    const deps = {
      parseModel: (m) => ({ provider: "claude", model: m.split("/")[1] }),
      getConnections: async () => [{ id: "a" }],
      getUsage: async () => ({ quotas: { "weekly opus (7d)": { used: 99, total: 100 } } }),
    };
    expect(await evaluateComboModelSkip("cc/claude-opus-4-6", deps)).toBe(true);
    expect(await evaluateComboModelSkip("cc/claude-sonnet-4-6", deps)).toBe(false);
  });

  it("does not let a credit line skip a subscription that is still under 95%", () => {
    expect(isAccountAtUtilizationCap({
      "Weekly SuperGrok": { used: 10, total: 100, unlimited: false },
      "On-demand": { used: 40, total: 100, unlimited: false },
    })).toBe(false);
  });

  it("keeps a Team account when weekly is full but On-demand is under 25%", () => {
    expect(isAccountAtUtilizationCap({
      "session (5h)": { used: 99, total: 100, unlimited: false },
      "weekly (7d)": { used: 97, total: 100, unlimited: false },
      "On-demand": { used: 10, total: 100, unlimited: false },
    })).toBe(false);
  });

  it("skips a Team account when weekly is full and On-demand is at 25%", () => {
    expect(isAccountAtUtilizationCap({
      "weekly (7d)": { used: 96, total: 100, unlimited: false },
      "On-demand": { used: 25, total: 100, unlimited: false },
    })).toBe(true);
  });

  it("skips Cursor billing period at 95% (other-meter bucket)", () => {
    expect(isAccountAtUtilizationCap({
      "Billing period": { used: 95, total: 100, unlimited: false },
    })).toBe(true);
    expect(isAccountAtUtilizationCap({
      "Billing period": { used: 94, total: 100, unlimited: false },
      Auto: { used: 99, total: 100, unlimited: false },
    })).toBe(true);
    expect(isAccountAtUtilizationCap({
      "Billing period": { used: 50, total: 100, unlimited: false },
      Auto: { used: 80, total: 100, unlimited: false },
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
