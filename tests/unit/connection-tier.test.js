import { describe, expect, it } from "vitest";
import {
  getConnectionTier,
  isCompanyConnection,
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
});
