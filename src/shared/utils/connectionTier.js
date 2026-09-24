/** Account spend tier for personal vs company routing policy. */

export const CONNECTION_TIERS = [
  { value: "personal", label: "Personal" },
  { value: "company", label: "Company" },
];

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
