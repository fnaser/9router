import { parseModel } from "open-sse/services/model.js";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { evaluateComboModelSkip } from "open-sse/services/utilizationGate.js";
import { getProviderConnections } from "@/lib/localDb";
import { resolveConnectionProxyConfig } from "@/lib/network/connectionProxy";

const CACHE_MS = 3 * 60 * 1000;
const cache = new Map();

function proxyOptionsFrom(cfg) {
  return {
    connectionProxyEnabled: cfg?.connectionProxyEnabled === true,
    connectionProxyUrl: cfg?.connectionProxyUrl || "",
    connectionNoProxy: cfg?.connectionNoProxy || "",
    vercelRelayUrl: cfg?.vercelRelayUrl || "",
    strictProxy: false,
  };
}

async function getUsage(connection) {
  const hit = connection?.id ? cache.get(connection.id) : null;
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.usage;

  const proxyCfg = await resolveConnectionProxyConfig(connection?.providerSpecificData);
  const usage = await getUsageForProvider(connection, proxyOptionsFrom(proxyCfg));
  if (connection?.id && usage?.quotas) {
    cache.set(connection.id, { at: Date.now(), usage });
  }
  return usage;
}

/** Combo hook: skip this model when every active account is freshly at or above 95% used. */
export function shouldSkipComboModel(modelStr) {
  return evaluateComboModelSkip(modelStr, {
    parseModel,
    getConnections: (provider) => getProviderConnections({ provider, isActive: true }),
    getUsage,
  });
}
