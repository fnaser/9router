// A Retry-After that 9router synthesizes for the client must not be stored as
// a provider reset: markAccountUnavailable treats resetsAtMs as exact and
// would pin the account's 429 backoff at its first level.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { executeMock, dbMocks } = vi.hoisted(() => ({
  executeMock: vi.fn(),
  dbMocks: {
    getProviderConnections: vi.fn(),
    updateProviderConnection: vi.fn(),
  },
}));

vi.mock("../../open-sse/executors/index.js", () => ({
  getExecutor: vi.fn(() => ({
    execute: executeMock,
    refreshCredentials: vi.fn().mockResolvedValue(null),
    noAuth: true,
  })),
}));
vi.mock("../../open-sse/utils/requestLogger.js", () => ({
  createRequestLogger: vi.fn(async () => ({
    logClientRawRequest: vi.fn(),
    logRawRequest: vi.fn(),
    logTargetRequest: vi.fn(),
    logError: vi.fn(),
  })),
}));
vi.mock("../../open-sse/utils/clientDetector.js", () => ({
  detectClientTool: vi.fn(() => null),
  isNativePassthrough: vi.fn(() => false),
}));
vi.mock("../../open-sse/utils/bypassHandler.js", () => ({ handleBypassRequest: vi.fn(() => null) }));
vi.mock("../../open-sse/utils/streamHandler.js", () => ({
  createStreamController: vi.fn(() => ({ signal: undefined, handleComplete: vi.fn(), handleError: vi.fn() })),
}));
vi.mock("../../open-sse/services/tokenRefresh.js", () => ({ refreshWithRetry: vi.fn() }));
vi.mock("../../open-sse/utils/proxyFetch.js", () => ({ default: vi.fn(), proxyAwareFetch: vi.fn() }));
vi.mock("../../open-sse/translator/concerns/prefetch.js", () => ({ prefetchRemoteImages: vi.fn(async () => 0) }));
vi.mock("../../open-sse/handlers/chatCore/requestDetail.js", () => ({
  buildRequestDetail: vi.fn((detail) => detail),
  extractRequestConfig: vi.fn((body, stream) => ({ body, stream })),
}));
vi.mock("@/lib/usageDb.js", () => ({
  trackPendingRequest: vi.fn(),
  appendRequestLog: vi.fn(() => Promise.resolve()),
  saveRequestDetail: vi.fn(() => Promise.resolve()),
}));
vi.mock("@/lib/localDb", () => dbMocks);
vi.mock("@/lib/network/connectionProxy", () => ({
  pickProxyPoolId: vi.fn(),
  resolveConnectionProxyConfig: vi.fn(),
}));
vi.mock("@/shared/constants/providers.js", () => ({
  FREE_PROVIDERS: {},
  resolveProviderId: (provider) => provider,
}));
vi.mock("@/sse/utils/logger.js", () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn() }));

const { handleChatCore } = await import("../../open-sse/handlers/chatCore.js");
const { markAccountUnavailable } = await import("../../src/sse/services/auth.js");

function upstream(status, body, headers = {}) {
  executeMock.mockResolvedValue({
    response: new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } }),
    url: "https://upstream.test/v1/chat/completions",
    headers: {},
    transformedBody: null,
  });
}

function callChatCore() {
  const body = { model: "deepseek-chat", stream: false, messages: [{ role: "user", content: "hi" }] };
  return handleChatCore({
    body,
    modelInfo: { provider: "deepseek", model: "deepseek-chat" },
    credentials: { apiKey: "sk-test" },
    clientRawRequest: { endpoint: "/v1/chat/completions", body, headers: { accept: "application/json" } },
    connectionId: "acc-a",
    log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  });
}

beforeEach(() => {
  executeMock.mockReset();
  dbMocks.getProviderConnections.mockReset();
  dbMocks.updateProviderConnection.mockReset();
});

describe("chatCore error result", () => {
  it("sends a synthesized Retry-After but reports no provider reset for a bare 429", async () => {
    upstream(429, { error: { message: "Rate limit reached for requests" } });
    const result = await callChatCore();
    expect(result.status).toBe(429);
    expect(result.resetsAtMs).toBeUndefined();
    expect(Number(result.response.headers.get("Retry-After"))).toBeGreaterThanOrEqual(1);
  });

  it("passes an upstream Retry-After through as the provider reset", async () => {
    upstream(429, { error: { message: "slow down" } }, { "Retry-After": "30" });
    const result = await callChatCore();
    expect(result.resetsAtMs - Date.now()).toBeGreaterThan(25_000);
    expect(Number(result.response.headers.get("Retry-After"))).toBeGreaterThan(25);
  });

  it("advertises no retry for a 402 even when the body says quota exceeded", async () => {
    upstream(402, { error: { message: "quota exceeded, add credits" } }, { "Retry-After": "30" });
    const result = await callChatCore();
    expect(result.response.headers.get("Retry-After")).toBeNull();
  });
});

describe("account backoff after a bare 429", () => {
  it("keeps escalating the backoff level", async () => {
    dbMocks.getProviderConnections.mockResolvedValue([{ id: "acc-a", provider: "deepseek", backoffLevel: 3 }]);
    upstream(429, { error: { message: "Rate limit reached for requests" } });
    const result = await callChatCore();

    const { cooldownMs } = await markAccountUnavailable(
      "acc-a", result.status, result.error, "deepseek", "deepseek-chat", result.resetsAtMs,
    );

    const update = dbMocks.updateProviderConnection.mock.calls[0][1];
    expect(update.backoffLevel).toBe(4);
    expect(cooldownMs).toBe(16_000);
  });
});
