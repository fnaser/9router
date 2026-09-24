import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../open-sse/utils/proxyFetch.js", () => ({
  proxyAwareFetch: vi.fn(),
}));

import { proxyAwareFetch } from "../../open-sse/utils/proxyFetch.js";
import { getCursorUsage, probeCursorAccessToken } from "../../open-sse/services/usage/cursor.js";
import { getUsageForProvider } from "../../open-sse/services/usage.js";
import { parseQuotaData } from "../../src/app/(dashboard)/dashboard/usage/components/ProviderLimits/utils.js";

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

describe("cursor usage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes through getUsageForProvider", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse(200, {
      planUsage: { limit: 1000, includedSpend: 400, autoPercentUsed: 12 },
      billingCycleEnd: Date.parse("2026-10-01T00:00:00Z"),
      membershipType: "pro",
    }));
    const res = await getUsageForProvider({ provider: "cursor", accessToken: "tok" });
    expect(res.quotas["Billing period"]).toMatchObject({
      used: 400,
      total: 1000,
      remainingPercentage: 60,
    });
    expect(res.quotas.Auto).toMatchObject({ used: 12, total: 100 });
  });

  it("marks over-limit spend as fully used so the gate can skip", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse(200, {
      planUsage: { limit: 100, includedSpend: 150 },
      displayMessage: "You've hit your usage limit",
    }));
    const res = await getCursorUsage("tok");
    expect(res.quotas["Billing period"]).toMatchObject({
      used: 100,
      total: 100,
      remainingPercentage: 0,
    });
  });

  it("maps into ProviderLimits cursor case", async () => {
    const quotas = parseQuotaData("cursor", {
      quotas: {
        "Billing period": { used: 80, total: 100, remaining: 20, remainingPercentage: 20 },
      },
    });
    expect(quotas).toEqual([
      expect.objectContaining({ name: "Billing period", used: 80, total: 100 }),
    ]);
  });

  it("probeCursorAccessToken fails on 401", async () => {
    proxyAwareFetch.mockResolvedValue(jsonResponse(401, {}));
    const probe = await probeCursorAccessToken("revoked");
    expect(probe).toEqual({ ok: false, status: 401, error: "Token invalid or revoked" });
  });
});
