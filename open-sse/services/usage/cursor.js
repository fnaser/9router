/**
 * Cursor IDE usage — billing-period spend from DashboardService.
 * Cheap JSON probe (no protobuf / machineId checksum).
 */
import { proxyAwareFetch } from "../../utils/proxyFetch.js";

const USAGE_URL = "https://api2.cursor.sh/aiserver.v1.DashboardService/GetCurrentPeriodUsage";

/**
 * @param {string} accessToken
 * @param {object|null} _providerSpecificData
 * @param {object|null} proxyOptions
 * @returns {Promise<{ plan?: string, quotas?: object, message?: string }>}
 */
export async function getCursorUsage(accessToken, _providerSpecificData = null, proxyOptions = null) {
  if (!accessToken) return { message: "Cursor access token missing" };

  try {
    const res = await proxyAwareFetch(USAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      body: "{}",
    }, proxyOptions);

    if (res.status === 401 || res.status === 403) {
      return { message: "Cursor token invalid or revoked" };
    }
    if (!res.ok) {
      return { message: `Cursor usage API returned ${res.status}` };
    }

    const data = await res.json();
    const planUsage = data?.planUsage || {};
    const limit = Number(planUsage.limit);
    const included = Number(planUsage.includedSpend ?? planUsage.totalSpend);
    const quotas = {};

    // Land in the gate's "other" bucket (95% skip), not credit-at-25%.
    if (Number.isFinite(limit) && limit > 0 && Number.isFinite(included)) {
      const used = Math.min(Math.max(0, included), limit);
      // Over-limit spend still reports as full so Pro-capped accounts skip.
      const atCap = included >= limit || /hit your usage limit/i.test(String(data?.displayMessage || ""));
      quotas["Billing period"] = {
        used: atCap ? limit : used,
        total: limit,
        remaining: Math.max(0, limit - used),
        remainingPercentage: atCap ? 0 : Math.round(((limit - used) / limit) * 100),
        resetAt: data?.billingCycleEnd
          ? new Date(Number(data.billingCycleEnd)).toISOString()
          : null,
        unlimited: false,
      };
    }

    const autoPct = Number(planUsage.autoPercentUsed);
    if (Number.isFinite(autoPct) && autoPct >= 0) {
      const used = Math.min(100, Math.max(0, autoPct));
      quotas["Auto"] = {
        used,
        total: 100,
        remaining: Math.max(0, 100 - used),
        remainingPercentage: Math.max(0, 100 - used),
        resetAt: null,
        unlimited: false,
      };
    }

    if (Object.keys(quotas).length === 0) {
      return {
        plan: data?.membershipType || "Cursor",
        message: data?.displayMessage || "Cursor connected. No usage meters reported.",
      };
    }

    return {
      plan: "Cursor",
      message: data?.displayMessage || null,
      quotas,
    };
  } catch (error) {
    return { message: `Cursor connected. Unable to fetch usage: ${error.message}` };
  }
}

/** Live auth probe used by import + dashboard Test Connection. */
export async function probeCursorAccessToken(accessToken, proxyOptions = null) {
  if (!accessToken) return { ok: false, status: 0, error: "No access token" };
  try {
    const res = await proxyAwareFetch(USAGE_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0",
      },
      body: "{}",
    }, proxyOptions);
    if (res.ok) return { ok: true, status: res.status, error: null };
    if (res.status === 401) return { ok: false, status: 401, error: "Token invalid or revoked" };
    if (res.status === 403) return { ok: false, status: 403, error: "Access denied" };
    return { ok: false, status: res.status, error: `API returned ${res.status}` };
  } catch (error) {
    return { ok: false, status: 0, error: error.message || "Cursor probe failed" };
  }
}
