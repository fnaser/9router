// GLM / Z.AI error classification, pinned to payloads captured from the live
// provider on 2026-09-18.
//
// Live probe against open.bigmodel.cn returned HTTP/2 429 whose headers carry
// no Retry-After and whose bodies are:
//
//   {"error":{"code":"1302","message":"Rate limit reached for requests"}}
//   {"error":{"code":"1113","message":"余额不足或无可用资源包,请充值。"}}
//
// 1302 is a transient rate limit; 1113 means the account is out of credit.
// Both arrive as 429. A terminal result still falls through to the next combo
// model; it just does not enter the exponential retry ladder.
import { describe, it, expect } from "vitest";
import { checkFallbackError } from "open-sse/services/accountFallback.js";
import { createErrorResult } from "open-sse/utils/error.js";

const GLM_RATE_LIMIT = JSON.stringify({ error: { code: "1302", message: "Rate limit reached for requests" } });
const GLM_NO_BALANCE = JSON.stringify({ error: { code: "1113", message: "余额不足或无可用资源包,请充值。" } });

describe("terminal billing errors are not retried", () => {
  it("classifies GLM 1113 (insufficient balance) as terminal and still falls through", () => {
    const r = checkFallbackError(429, GLM_NO_BALANCE, 0);
    expect(r.terminal).toBe(true);
    expect(r.shouldFallback).toBe(true);
    expect(r.newBackoffLevel).toBeUndefined();
  });

  it("classifies an English insufficient-balance body as terminal", () => {
    const r = checkFallbackError(429, "Insufficient balance, please top up");
    expect(r.terminal).toBe(true);
    expect(r.shouldFallback).toBe(true);
  });

  it("treats HTTP 402 as terminal without stopping combo fallback", () => {
    const r = checkFallbackError(402, "payment required");
    expect(r.terminal).toBe(true);
    expect(r.shouldFallback).toBe(true);
    expect(r.newBackoffLevel).toBeUndefined();
  });

  it("does NOT mark a real rate limit as terminal", () => {
    const r = checkFallbackError(429, GLM_RATE_LIMIT, 0);
    expect(r.terminal).toBeFalsy();
    expect(r.shouldFallback).toBe(true);
    expect(r.newBackoffLevel).toBe(1);
    expect(r.cooldownMs).toBeGreaterThan(0);
  });

  it("keeps billing ahead of rate-limit matching", () => {
    const mixed = JSON.stringify({ error: { message: "rate limit — 余额不足,请充值" } });
    expect(checkFallbackError(429, mixed).terminal).toBe(true);
  });
});

describe("synthesized cooldown escalates for transient limits", () => {
  it("grows with the backoff level", () => {
    const first = checkFallbackError(429, GLM_RATE_LIMIT, 0);
    const later = checkFallbackError(429, GLM_RATE_LIMIT, 4);
    expect(later.cooldownMs).toBeGreaterThan(first.cooldownMs);
    expect(later.newBackoffLevel).toBe(5);
  });

  it("produces a Retry-After a client can honor", () => {
    const { cooldownMs, terminal } = checkFallbackError(429, GLM_RATE_LIMIT, 3);
    expect(terminal).toBeFalsy();
    const res = createErrorResult(429, "Rate limit reached for requests", Date.now() + cooldownMs).response;
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("advertises no retry for a terminal billing error", () => {
    const { terminal } = checkFallbackError(429, GLM_NO_BALANCE, 0);
    expect(terminal).toBe(true);
    const res = createErrorResult(429, "insufficient balance").response;
    expect(res.headers.get("Retry-After")).toBeNull();
  });
});
