import { describe, expect, it } from "vitest";
import {
  getConnectionTier,
  isCompanyConnection,
  resolveRequiredAccountTier,
  connectionMatchesRequiredTier,
  ACCOUNT_TIER_HEADER,
} from "../../src/shared/utils/connectionTier.js";

describe("connectionTier", () => {
  it("reads providerSpecificData.tier", () => {
    expect(getConnectionTier({ providerSpecificData: { tier: "company" } })).toBe("company");
    expect(getConnectionTier({ providerSpecificData: { tier: "personal" } })).toBe("personal");
  });

  it("falls back to name prefix then personal", () => {
    expect(getConnectionTier({ name: "[company] Claude liquid" })).toBe("company");
    expect(getConnectionTier({ name: "[personal] Claude" })).toBe("personal");
    expect(getConnectionTier({ name: "Claude personal" })).toBe("personal");
    expect(getConnectionTier({})).toBe("personal");
  });

  it("prefers explicit tier over name prefix", () => {
    expect(getConnectionTier({
      name: "[personal] mislabeled",
      providerSpecificData: { tier: "company" },
    })).toBe("company");
  });

  it("isCompanyConnection mirrors company tier", () => {
    expect(isCompanyConnection({ providerSpecificData: { tier: "company" } })).toBe(true);
    expect(isCompanyConnection({ name: "x" })).toBe(false);
  });

  it("resolveRequiredAccountTier reads header over env", () => {
    const headers = new Headers({ [ACCOUNT_TIER_HEADER]: "company" });
    expect(resolveRequiredAccountTier({ headers, env: { FORK_ACCOUNT_TIER: "personal" } })).toBe("company");
    expect(resolveRequiredAccountTier({ headers: {}, env: { FORK_ACCOUNT_TIER: "personal" } })).toBe("personal");
    expect(resolveRequiredAccountTier({ headers: {}, env: {} })).toBe(null);
    expect(resolveRequiredAccountTier({ headers: { [ACCOUNT_TIER_HEADER]: "nope" }, env: {} })).toBe(null);
  });

  it("connectionMatchesRequiredTier", () => {
    const company = { providerSpecificData: { tier: "company" } };
    const personal = { providerSpecificData: { tier: "personal" } };
    expect(connectionMatchesRequiredTier(company, null)).toBe(true);
    expect(connectionMatchesRequiredTier(company, "company")).toBe(true);
    expect(connectionMatchesRequiredTier(personal, "company")).toBe(false);
  });
});
