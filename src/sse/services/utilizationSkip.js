import { parseModel } from "open-sse/services/model.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import {
  evaluateComboModelSkip,
  shouldSkipModelForUtilization,
} from "open-sse/services/utilizationGate.js";
import { isModelLockActive, getModelLockRemainingMs } from "open-sse/services/accountFallback.js";
import { getProviderConnections } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { checkAndRefreshToken } from "./tokenRefresh.js";
import { getAllConnectionsTrip } from "./providerCircuit.js";

const CACHE_MS = 3 * 60 * 1000;
const FAILURE_CACHE_MS = 60 * 1000;
const LAST_GOOD_MAX_AGE_MS = 15 * 60 * 1000;
const USAGE_FETCH_TIMEOUT_MS = 3000;
const UNAVAILABLE = { message: "usage unavailable" };
const TIMED_OUT = Symbol("usage timeout");
const cache = new Map();
const lastGood = new Map();
const inflight = new Map();

function proxyOptionsFrom(cfg) {
  return {
    connectionProxyEnabled: cfg?.connectionProxyEnabled === true,
    connectionProxyUrl: cfg?.connectionProxyUrl || "",
    connectionNoProxy: cfg?.connectionNoProxy || "",
    vercelRelayUrl: cfg?.vercelRelayUrl || "",
    strictProxy: false,
  };
}

async function refreshConnection(connection) {
  try {
    const refreshed = await checkAndRefreshToken(connection.provider, {
      ...connection,
      connectionId: connection.id,
    });
    if (!refreshed?.accessToken && !refreshed?.apiKey) return connection;
    return {
      ...connection,
      ...refreshed,
      id: connection.id,
      provider: connection.provider,
    };
  } catch {
    return connection;
  }
}

async function fetchUsage(connection) {
  const current = await refreshConnection(connection);
  const proxyCfg = await resolveConnectionProxyConfig(current?.providerSpecificData);
  return getUsageForProvider(current, proxyOptionsFrom(proxyCfg));
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
    timer.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function remember(id, usage) {
  if (!id) return;
  cache.set(id, { at: Date.now(), usage });
  if (usage?.quotas) lastGood.set(id, { at: Date.now(), usage });
}

function lastGoodOrUnavailable(id) {
  const hit = id ? lastGood.get(id) : null;
  if (hit?.usage?.quotas && Date.now() - hit.at < LAST_GOOD_MAX_AGE_MS) {
    return hit.usage;
  }
  return UNAVAILABLE;
}

/** Sync peek: short cache first, then last-good. No network. */
function peekUsage(connection) {
  const id = connection?.id;
  if (!id) return { usage: null, needsRefresh: true };

  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < (hit.usage ? CACHE_MS : FAILURE_CACHE_MS)) {
    if (hit.usage?.quotas) return { usage: hit.usage, needsRefresh: false };
    const lg = lastGoodOrUnavailable(id);
    return { usage: lg?.quotas ? lg : null, needsRefresh: true };
  }

  const lg = lastGood.get(id);
  if (lg?.usage?.quotas && Date.now() - lg.at < LAST_GOOD_MAX_AGE_MS) {
    return { usage: lg.usage, needsRefresh: true };
  }
  return { usage: null, needsRefresh: true };
}

/** Fire-and-forget usage refresh; coalesced via inflight. */
function kickBackgroundRefresh(connection) {
  const id = connection?.id;
  if (!id || inflight.has(id)) return;
  const job = fetchUsage(connection)
    .then((usage) => {
      remember(id, usage?.quotas ? usage : null);
      return usage?.quotas ? usage : lastGoodOrUnavailable(id);
    })
    .catch(() => {
      remember(id, null);
      return lastGoodOrUnavailable(id);
    })
    .finally(() => {
      inflight.delete(id);
    });
  inflight.set(id, job);
}

// A failed or slow read is remembered briefly so a hung usage endpoint does not
// cost the timeout on every request. A late success still fills the cache.
// On timeout/error, reuse the last good quotas (up to 15m) so the utilization
// gate can still skip accounts that were already near/at cap.
async function getUsage(connection) {
  const id = connection?.id;
  const hit = id ? cache.get(id) : null;
  if (hit && Date.now() - hit.at < (hit.usage ? CACHE_MS : FAILURE_CACHE_MS)) {
    return hit.usage || lastGoodOrUnavailable(id);
  }

  let job = id ? inflight.get(id) : null;
  if (!job) {
    job = fetchUsage(connection)
      .then((usage) => {
        remember(id, usage?.quotas ? usage : null);
        return usage?.quotas ? usage : lastGoodOrUnavailable(id);
      })
      .catch(() => {
        remember(id, null);
        return lastGoodOrUnavailable(id);
      })
      .finally(() => {
        if (id) inflight.delete(id);
      });
    if (id) inflight.set(id, job);
  }

  const usage = await withTimeout(job, USAGE_FETCH_TIMEOUT_MS);
  if (usage === TIMED_OUT) {
    // Do not wipe last-good — only mark a short failure so we retry soon.
    if (id) cache.set(id, { at: Date.now(), usage: null });
    return lastGoodOrUnavailable(id);
  }
  return usage;
}

/**
 * Combo hook: skip when every active account is at its cap, all accounts are
 * model-locked, or every active connection just connect-timed-out (per-connection
 * circuit). Warm path: if every account already has cache/last-good quotas,
 * decide without awaiting provider usage HTTP — refresh stale rows in the
 * background.
 *
 * @returns {Promise<false|string|{reason:string,retryAfterMs?:number}>} false = try
 *   the model; a string is the skip reason; an object may also carry retryAfterMs
 *   (used for connection circuit so combo can advertise Retry-After).
 */
export async function shouldSkipComboModel(modelStr) {
  const parsed = parseModel(modelStr);
  const provider = parsed?.provider;
  if (!provider) return false;

  let connections;
  try {
    connections = await getProviderConnections({ provider, isActive: true });
  } catch {
    return false;
  }
  if (!Array.isArray(connections) || connections.length === 0) return false;

  // Parallel turns: after connect timeouts, skip only when every active
  // connection is tripped — a healthy sibling account can still be tried.
  const { allTripped, retryAfterMs } = getAllConnectionsTrip(connections.map((c) => c.id));
  if (allTripped) {
    return { reason: "connection circuit", retryAfterMs };
  }

  const model = parsed.model;
  if (connections.every((c) => isModelLockActive(c, model))) {
    let minRem = Infinity;
    for (const c of connections) {
      const rem = getModelLockRemainingMs(c, model);
      if (rem > 0 && rem < minRem) minRem = rem;
    }
    return {
      reason: "model locked",
      retryAfterMs: minRem === Infinity ? 0 : minRem,
    };
  }

  const snapshots = [];
  const refresh = [];
  for (const connection of connections) {
    const { usage, needsRefresh } = peekUsage(connection);
    if (!usage?.quotas) {
      const skip = await evaluateComboModelSkip(modelStr, {
        parseModel,
        getConnections: async () => connections,
        getUsage,
      });
      return skip ? "utilization cap" : false;
    }
    snapshots.push(usage.quotas);
    if (needsRefresh) refresh.push(connection);
  }

  for (const connection of refresh) kickBackgroundRefresh(connection);
  return shouldSkipModelForUtilization(snapshots, parsed.model) ? "utilization cap" : false;
}

/** Test helpers */
export function _resetUtilizationSkipCacheForTests() {
  cache.clear();
  lastGood.clear();
  inflight.clear();
}

export function _rememberUsageForTests(id, usage) {
  remember(id, usage);
}

export function _lastGoodOrUnavailableForTests(id) {
  return lastGoodOrUnavailable(id);
}

export function _peekUsageForTests(connection) {
  return peekUsage(connection);
}
