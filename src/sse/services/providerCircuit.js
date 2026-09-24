/**
 * In-process circuit for providers that just connect-timed-out.
 * Stops parallel combo turns from each burning FETCH_CONNECT_TIMEOUT_MS on
 * the same hung peer before model locks land in SQLite.
 */

const trippedUntil = new Map(); // provider -> epoch ms

const DEFAULT_TRIP_MS = 20_000;

/** Mark provider hot after a connect timeout (or similar hard fail). */
export function tripProvider(provider, ms = DEFAULT_TRIP_MS) {
  if (!provider) return;
  const until = Date.now() + Math.max(1_000, ms);
  const prev = trippedUntil.get(provider) || 0;
  if (until > prev) trippedUntil.set(provider, until);
}

/** True while the provider should be skipped by combo pre-checks. */
export function isProviderTripped(provider) {
  if (!provider) return false;
  const until = trippedUntil.get(provider);
  if (!until) return false;
  if (Date.now() >= until) {
    trippedUntil.delete(provider);
    return false;
  }
  return true;
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
