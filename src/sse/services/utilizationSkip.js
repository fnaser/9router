import { parseModel } from "open-sse/services/model.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { evaluateComboModelSkip } from "open-sse/services/utilizationGate.js";
import { getProviderConnections } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";
import { checkAndRefreshToken } from "./tokenRefresh.js";

const CACHE_MS = 3 * 60 * 1000;
const FAILURE_CACHE_MS = 60 * 1000;
const USAGE_FETCH_TIMEOUT_MS = 3000;
const UNAVAILABLE = { message: "usage unavailable" };
const TIMED_OUT = Symbol("usage timeout");
const cache = new Map();
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
  if (id) cache.set(id, { at: Date.now(), usage });
}

// A failed or slow read is remembered briefly so a hung usage endpoint does not
// cost the timeout on every request. A late success still fills the cache.
async function getUsage(connection) {
  const id = connection?.id;
  const hit = id ? cache.get(id) : null;
  if (hit && Date.now() - hit.at < (hit.usage ? CACHE_MS : FAILURE_CACHE_MS)) {
    return hit.usage || UNAVAILABLE;
  }

  let job = id ? inflight.get(id) : null;
  if (!job) {
    job = fetchUsage(connection)
      .then((usage) => {
        remember(id, usage?.quotas ? usage : null);
        return usage;
      })
      .catch(() => {
        remember(id, null);
        return UNAVAILABLE;
      })
      .finally(() => {
        if (id) inflight.delete(id);
      });
    if (id) inflight.set(id, job);
  }

  const usage = await withTimeout(job, USAGE_FETCH_TIMEOUT_MS);
  if (usage === TIMED_OUT) {
    remember(id, null);
    return UNAVAILABLE;
  }
  return usage;
}

/** Combo hook: skip when every active account is at its cap (95% subscription, 25% credit-only). */
export function shouldSkipComboModel(modelStr) {
  return evaluateComboModelSkip(modelStr, {
    parseModel,
    getConnections: (provider) => getProviderConnections({ provider, isActive: true }),
    getUsage,
  });
}
