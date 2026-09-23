/** Used fraction at which a combo model is skipped before the request is sent. */
export const UTILIZATION_SKIP_RATIO = 0.95;

/**
 * True when a capped quota window is at or above the skip ratio.
 * Unlimited windows and balance-only rows (no spent/total pair) do not qualify:
 * a prepaid pot stored as used=0 stays under the ratio until a real cap exists.
 * @param {Record<string, { used?: number, total?: number, unlimited?: boolean }>|null|undefined} quotas
 * @param {number} [ratio]
 */
export function isAccountAtUtilizationCap(quotas, ratio = UTILIZATION_SKIP_RATIO) {
  if (!quotas || typeof quotas !== "object") return false;
  for (const quota of Object.values(quotas)) {
    if (!quota || typeof quota !== "object") continue;
    if (quota.unlimited === true) continue;
    const total = Number(quota.total);
    const used = Number(quota.used);
    if (!Number.isFinite(total) || total <= 0) continue;
    if (!Number.isFinite(used) || used < 0) continue;
    if (used / total >= ratio) return true;
  }
  return false;
}

/**
 * Skip only when every account has a quota object and each one is at the cap.
 * No accounts, a missing snapshot, or any account under the cap keeps the model.
 * @param {Array<Record<string, unknown>|null|undefined>} accountQuotas
 * @param {number} [ratio]
 */
export function shouldSkipModelForUtilization(accountQuotas, ratio = UTILIZATION_SKIP_RATIO) {
  if (!Array.isArray(accountQuotas) || accountQuotas.length === 0) return false;
  return accountQuotas.every((quotas) => isAccountAtUtilizationCap(quotas, ratio));
}

/**
 * Decide whether a combo model should be skipped from injected account/usage reads.
 * A failed lookup or a usage payload without `quotas` keeps the model.
 * @param {string} modelStr
 * @param {{ parseModel: Function, getConnections: Function, getUsage: Function }} deps
 * @param {number} [ratio]
 */
export async function evaluateComboModelSkip(modelStr, deps, ratio = UTILIZATION_SKIP_RATIO) {
  const provider = deps.parseModel(modelStr)?.provider;
  if (!provider) return false;

  let connections;
  try {
    connections = await deps.getConnections(provider);
  } catch {
    return false;
  }
  if (!Array.isArray(connections) || connections.length === 0) return false;

  const snapshots = [];
  for (const connection of connections) {
    let usage;
    try {
      usage = await deps.getUsage(connection);
    } catch {
      return false;
    }
    const quotas = usage?.quotas;
    if (!quotas || typeof quotas !== "object") return false;
    snapshots.push(quotas);
  }
  return shouldSkipModelForUtilization(snapshots, ratio);
}
