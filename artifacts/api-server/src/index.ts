import { bootstrapApi } from "./lib/api-bootstrap";
import { safeRestartRequested } from "./lib/safe-restart-policy";

try {
  await bootstrapApi(process.env, process.argv.slice(2), {
    normal: async () => { await import("./normal-server"); },
    safe: async guard => {
      // Built-ins and the restricted handler only; no provider/route imports.
      const { readFileSync } = await import("node:fs");
      const { createHash } = await import("node:crypto");
      const bundleSha256 = createHash("sha256").update(readFileSync(new URL(import.meta.url))).digest("hex");
      const normalBundleSha256 = createHash("sha256")
        .update(readFileSync(new URL("./normal-server.mjs", import.meta.url))).digest("hex");
      const { startSafeRestartServer } = await import("./safe-restart-server");
      await startSafeRestartServer(guard, { bundleSha256, normalBundleSha256 });
    },
    terminal: async target => {
      const { startTerminalTestServer } = await import("./terminal-test-server");
      await startTerminalTestServer(target);
    },
    checked: async target => {
      const { logger } = await import("./lib/logger");
      logger.info({ mode: "configuration-check-only", host: target.host, database: target.database,
        workers: "not-started", databaseConnected: false }, "Local terminal test target configuration passed");
    },
  });
} catch {
  // Do not import the pino worker/normal dependency graph after safe-mode failure.
  // Invalid or Production requests must fail closed too, not fall back.
  let safeOption = false;
  try { safeOption = safeRestartRequested(process.env, process.argv.slice(2)); }
  catch { safeOption = true; }
  if (safeOption) {
    process.stderr.write("Development Safe Restart startup refused or failed; normal API was not started.\n");
    process.exitCode = 1;
  } else {
  // Never expose environment values, driver errors or connection strings.
  const { logger } = await import("./lib/logger");
  logger.error("API startup refused or failed; check the explicit terminal test configuration and private socket");
  process.exitCode = 1;
  }
}
