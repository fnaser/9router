import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  tripProvider,
  isProviderTripped,
  clearProviderTrip,
  getProviderTripRemainingMs,
  _resetProviderCircuitForTests,
  _tripUntilForTests,
} from "../../src/sse/services/providerCircuit.js";

describe("providerCircuit", () => {
  beforeEach(() => {
    _resetProviderCircuitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("trips a provider for the default window", () => {
    expect(isProviderTripped("claude")).toBe(false);
    tripProvider("claude");
    expect(isProviderTripped("claude")).toBe(true);
    expect(_tripUntilForTests("claude")).toBeGreaterThan(Date.now());
  });

  it("expires after the trip window", () => {
    tripProvider("codex", 5_000);
    expect(isProviderTripped("codex")).toBe(true);
    vi.advanceTimersByTime(5_001);
    expect(isProviderTripped("codex")).toBe(false);
  });

  it("clearProviderTrip removes the trip early", () => {
    tripProvider("xai", 60_000);
    clearProviderTrip("xai");
    expect(isProviderTripped("xai")).toBe(false);
  });

  it("extends an existing trip when a later failure arrives", () => {
    tripProvider("claude", 5_000);
    const first = _tripUntilForTests("claude");
    tripProvider("claude", 20_000);
    expect(_tripUntilForTests("claude")).toBeGreaterThan(first);
  });

  it("reports remaining trip milliseconds", () => {
    tripProvider("claude", 10_000);
    expect(getProviderTripRemainingMs("claude")).toBeGreaterThan(9_000);
    expect(getProviderTripRemainingMs("claude")).toBeLessThanOrEqual(10_000);
    vi.advanceTimersByTime(10_001);
    expect(getProviderTripRemainingMs("claude")).toBe(0);
  });
});
