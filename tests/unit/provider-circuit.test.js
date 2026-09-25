import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  tripConnection,
  clearConnectionTrip,
  getConnectionTripRemainingMs,
  getAllConnectionsTrip,
  _resetProviderCircuitForTests,
  _tripUntilForTests,
} from "../../src/sse/services/providerCircuit.js";
import { CONNECT_TIMEOUT_SOFT_COOL_MS } from "../../open-sse/config/errorConfig.js";

describe("providerCircuit (per-connection)", () => {
  beforeEach(() => {
    _resetProviderCircuitForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("trips a connection for the default window", () => {
    expect(getConnectionTripRemainingMs("conn-a")).toBe(0);
    tripConnection("conn-a");
    expect(getConnectionTripRemainingMs("conn-a")).toBeGreaterThan(0);
    expect(_tripUntilForTests("conn-a")).toBe(Date.now() + CONNECT_TIMEOUT_SOFT_COOL_MS);
  });

  it("expires after the trip window", () => {
    tripConnection("conn-b", 5_000);
    expect(getConnectionTripRemainingMs("conn-b")).toBeGreaterThan(0);
    vi.advanceTimersByTime(5_001);
    expect(getConnectionTripRemainingMs("conn-b")).toBe(0);
  });

  it("clearConnectionTrip removes the trip early", () => {
    tripConnection("conn-c", 60_000);
    clearConnectionTrip("conn-c");
    expect(getConnectionTripRemainingMs("conn-c")).toBe(0);
  });

  it("extends an existing trip when a later failure arrives", () => {
    tripConnection("conn-d", 5_000);
    const first = _tripUntilForTests("conn-d");
    tripConnection("conn-d", CONNECT_TIMEOUT_SOFT_COOL_MS);
    expect(_tripUntilForTests("conn-d")).toBeGreaterThan(first);
  });

  it("getAllConnectionsTrip is false when any sibling is healthy", () => {
    tripConnection("a", 10_000);
    expect(getAllConnectionsTrip(["a", "b"])).toEqual({ allTripped: false, retryAfterMs: 0 });
  });

  it("getAllConnectionsTrip is true when every connection is tripped", () => {
    tripConnection("a", 10_000);
    tripConnection("b", 8_000);
    const { allTripped, retryAfterMs } = getAllConnectionsTrip(["a", "b"]);
    expect(allTripped).toBe(true);
    expect(retryAfterMs).toBeGreaterThan(7_000);
    expect(retryAfterMs).toBeLessThanOrEqual(8_000);
  });

  it("getAllConnectionsTrip is false for an empty id list", () => {
    expect(getAllConnectionsTrip([])).toEqual({ allTripped: false, retryAfterMs: 0 });
  });

  it("ignores empty connection ids", () => {
    tripConnection("", 10_000);
    expect(getConnectionTripRemainingMs("")).toBe(0);
    expect(getAllConnectionsTrip([null, undefined, ""])).toEqual({
      allTripped: false,
      retryAfterMs: 0,
    });
  });
});
