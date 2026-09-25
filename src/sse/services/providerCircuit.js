/**
 * In-process circuit for providers that just connect-timed-out.
 * Stops parallel combo turns from each burning the headers/TTFT wait on
 * the same hung peer before model locks land in SQLite.
 */

import { CONNECT_TIMEOUT_SOFT_COOL_MS } from "open-sse/config/errorConfig.js";

const trippedUntil = new Map(); // provider -> epoch ms

/** Mark provider hot after a connect timeout (or similar hard fail). */
export function tripProvider(provider, ms = CONNECT_TIMEOUT_SOFT_COOL_MS) {
  if (!provider) return;
  const until = Date.now() + Math.max(1_000, ms);
  const prev = trippedUntil.get(provider) || 0;
  if (until > prev) trippedUntil.set(provider, until);
}

/** True while the provider should be skipped by combo pre-checks. */
export function isProviderTripped(provider) {
  return getProviderTripRemainingMs(provider) > 0;
}

/** Milliseconds left on the trip, or 0 if not tripped / expired. */
export function getProviderTripRemainingMs(provider) {
  if (!provider) return 0;
  const until = trippedUntil.get(provider);
  if (!until) return 0;
  const rem = until - Date.now();
  if (rem <= 0) {
    trippedUntil.delete(provider);
    return 0;
  }
  return rem;
}

export function clearProviderTrip(provider) {
  if (provider) trippedUntil.delete(provider);
}

/** Test helpers */
export function _resetProviderCircuitForTests() {
  trippedUntil.clear();
}

export function _tripUntilForTests(provider) {
  return trippedUntil.get(provider) || 0;
}
