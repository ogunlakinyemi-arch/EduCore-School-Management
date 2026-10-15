import { bootstrapApi } from "./lib/api-bootstrap";

try {
  await bootstrapApi(process.env, process.argv.slice(2), {
    normal: async () => { await import("./normal-server"); },
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
  // Never expose environment values, driver errors or connection strings.
  const { logger } = await import("./lib/logger");
  logger.error("API startup refused or failed; check the explicit terminal test configuration and private socket");
  process.exitCode = 1;
}
