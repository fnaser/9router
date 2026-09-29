/** Account spend tier for personal vs company routing policy. */

export const CONNECTION_TIERS = [
  { value: "personal", label: "Personal" },
  { value: "company", label: "Company" },
];

/** Request header clients (or a future LFM sidecar) set to force a tier. */
export const ACCOUNT_TIER_HEADER = "x-9router-account-tier";

/**
 * Resolve tier from providerSpecificData, then [personal]/[company] name prefix.
 * Untagged → personal (fail closed for sensitive routing later).
 */
export function getConnectionTier(connection) {
  const raw = connection?.providerSpecificData?.tier;
  if (raw === "company" || raw === "personal") return raw;

  const name = String(connection?.name || "").toLowerCase();
  if (name.startsWith("[company]")) return "company";
  if (name.startsWith("[personal]")) return "personal";
  return "personal";
}

export function isCompanyConnection(connection) {
  return getConnectionTier(connection) === "company";
}

/**
 * Optional hard filter for account selection.
 * Header `x-9router-account-tier: company|personal` wins; else env `FORK_ACCOUNT_TIER`.
 * @returns {"company"|"personal"|null} null = no tier filter (default today)
 */
export function resolveRequiredAccountTier({ headers, env = process.env } = {}) {
  let fromHeader = "";
  if (headers && typeof headers.get === "function") {
    fromHeader = headers.get(ACCOUNT_TIER_HEADER) || "";
  } else if (headers && typeof headers === "object") {
    fromHeader =
      headers[ACCOUNT_TIER_HEADER] ||
      headers["X-9router-Account-Tier"] ||
      headers["X-9Router-Account-Tier"] ||
      "";
  }
  const raw = String(fromHeader || env.FORK_ACCOUNT_TIER || "")
    .toLowerCase()
    .trim();
  if (raw === "company" || raw === "personal") return raw;
  return null;
}

/** True when connection matches a required tier (or no requirement). */
export function connectionMatchesRequiredTier(connection, requiredTier) {
  if (!requiredTier) return true;
  return getConnectionTier(connection) === requiredTier;
}
