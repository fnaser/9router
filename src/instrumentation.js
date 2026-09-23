export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initConsoleLogCapture } = await import("@/lib/consoleLogBuffer");
    initConsoleLogCapture();

    // Server-only: lets capabilities.js read the synced catalog without pulling
    // node:fs into the dashboard's browser bundle.
    const { installCatalogSource } = await import("open-sse/providers/catalogOverride.js");
    await installCatalogSource();

    const { startModelCatalogSync } = await import("@/lib/modelCatalog/sync.js");
    startModelCatalogSync();

    // Sole owner of the proactive OAuth refresh scheduler: starting it from a
    // second bundle would create a second loop racing on rotating refresh tokens.
    const { startBackgroundTokenRefresh } = await import("@/sse/services/backgroundTokenRefresh.js");
    startBackgroundTokenRefresh();
  }
}
