/**
 * In-process circuit for connections that just connect-timed-out.
 * Keyed by connectionId so a healthy sibling account for the same provider
 * can still be tried. Combo skips the provider only when every active
 * connection is tripped.
 */

import { CONNECT_TIMEOUT_SOFT_COOL_MS } from "open-sse/config/errorConfig.js";

const trippedUntil = new Map(); // connectionId -> epoch ms

/** Mark a connection hot after a connect timeout (or similar hard fail). */
export function tripConnection(connectionId, ms = CONNECT_TIMEOUT_SOFT_COOL_MS) {
  if (!connectionId) return;
  const until = Date.now() + Math.max(1_000, ms);
  const prev = trippedUntil.get(connectionId) || 0;
  if (until > prev) trippedUntil.set(connectionId, until);
}

/** Milliseconds left on a connection trip, or 0 if not tripped / expired. */
export function getConnectionTripRemainingMs(connectionId) {
  if (!connectionId) return 0;
  const until = trippedUntil.get(connectionId);
  if (!until) return 0;
  const rem = until - Date.now();
  if (rem <= 0) {
    trippedUntil.delete(connectionId);
    return 0;
  }
  return rem;
}

export function clearConnectionTrip(connectionId) {
  if (connectionId) trippedUntil.delete(connectionId);
}

/**
 * True when every listed connection is still tripped.
 * @param {string[]} connectionIds
 * @returns {{ allTripped: boolean, retryAfterMs: number }}
 */
export function getAllConnectionsTrip(connectionIds) {
  const ids = Array.isArray(connectionIds) ? connectionIds.filter(Boolean) : [];
  if (ids.length === 0) return { allTripped: false, retryAfterMs: 0 };
  let minRem = Infinity;
  for (const id of ids) {
    const rem = getConnectionTripRemainingMs(id);
    if (rem <= 0) return { allTripped: false, retryAfterMs: 0 };
    if (rem < minRem) minRem = rem;
  }
  return { allTripped: true, retryAfterMs: minRem === Infinity ? 0 : minRem };
}

/** @deprecated Use tripConnection — kept for tests that trip by a synthetic id. */
export function tripProvider(providerOrId, ms = CONNECT_TIMEOUT_SOFT_COOL_MS) {
  tripConnection(providerOrId, ms);
}

/** @deprecated Use getConnectionTripRemainingMs */
export function isProviderTripped(providerOrId) {
  return getConnectionTripRemainingMs(providerOrId) > 0;
}

/** @deprecated Use getConnectionTripRemainingMs */
export function getProviderTripRemainingMs(providerOrId) {
  return getConnectionTripRemainingMs(providerOrId);
}

/** @deprecated Use clearConnectionTrip */
export function clearProviderTrip(providerOrId) {
  clearConnectionTrip(providerOrId);
}

/** Test helpers */
export function _resetProviderCircuitForTests() {
  trippedUntil.clear();
}

export function _tripUntilForTests(connectionId) {
  return trippedUntil.get(connectionId) || 0;
}
