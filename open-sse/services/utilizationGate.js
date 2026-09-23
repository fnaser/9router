/** Used fraction at which a resetting subscription window is skipped. */
export const UTILIZATION_SKIP_RATIO = 0.95;

/** Used fraction at which a credit-only account is skipped. */
export const CREDIT_SKIP_RATIO = 0.25;

const SUBSCRIPTION_QUOTA = /session|weekly/i;
const CREDIT_QUOTA = /credit|on-demand|prepaid|monthly included/i;
// Codex also reports review and Spark meters. Those are not the chat window.
const SIDE_METER = /^(review|spark)[_\s-]/i;

function isSubscriptionQuota(name) {
  return SUBSCRIPTION_QUOTA.test(name) && !SIDE_METER.test(name);
}

function usedRatio(quota) {
  if (!quota || typeof quota !== "object") return null;
  if (quota.unlimited === true) return null;
  const total = Number(quota.total);
  const used = Number(quota.used);
  if (!Number.isFinite(total) || total <= 0) return null;
  if (!Number.isFinite(used) || used < 0) return null;
  return used / total;
}

/**
 * True when this account should be skipped.
 * A subscription window (session or weekly) skips at 95% used. Credit lines on
 * that same account do not. An account whose only quotas are credits skips
 * when any known cap is 25% spent. A prepaid row stored as used=0 has no
 * spend ratio, so it does not trip the credit cap.
 * @param {Record<string, { used?: number, total?: number, unlimited?: boolean }>|null|undefined} quotas
 */
export function isAccountAtUtilizationCap(quotas) {
  if (!quotas || typeof quotas !== "object") return false;
  const subscription = [];
  const credits = [];
  const other = [];
  for (const [name, quota] of Object.entries(quotas)) {
    const ratio = usedRatio(quota);
    if (ratio == null) continue;
    if (isSubscriptionQuota(name)) subscription.push(ratio);
    else if (CREDIT_QUOTA.test(name)) credits.push(ratio);
    else other.push(ratio);
  }
  if (subscription.length > 0) {
    return subscription.some((ratio) => ratio >= UTILIZATION_SKIP_RATIO);
  }
  if (credits.length > 0) {
    return credits.some((ratio) => ratio >= CREDIT_SKIP_RATIO);
  }
  return other.some((ratio) => ratio >= UTILIZATION_SKIP_RATIO);
}

/**
 * Skip only when every account has a quota object and each one is at the cap.
 * No accounts, a missing snapshot, or any account under the cap keeps the model.
 * @param {Array<Record<string, unknown>|null|undefined>} accountQuotas
 */
export function shouldSkipModelForUtilization(accountQuotas) {
  if (!Array.isArray(accountQuotas) || accountQuotas.length === 0) return false;
  return accountQuotas.every((quotas) => isAccountAtUtilizationCap(quotas));
}

/**
 * Decide whether a combo model should be skipped from injected account/usage reads.
 * A failed lookup or a usage payload without `quotas` keeps the model.
 * @param {string} modelStr
 * @param {{ parseModel: Function, getConnections: Function, getUsage: Function }} deps
 */
export async function evaluateComboModelSkip(modelStr, deps) {
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
  return shouldSkipModelForUtilization(snapshots);
}
