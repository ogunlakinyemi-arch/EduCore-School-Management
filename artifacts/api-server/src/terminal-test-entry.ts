import { bootstrapApi } from "./lib/api-bootstrap";

// A distinct build output prevents an old normal-server bundle from ignoring a
// new CLI flag and accidentally launching the preview's workers.
try {
  await bootstrapApi(process.env, ["--terminal-test", ...process.argv.slice(2)], {
    normal: async () => { throw new Error("Normal startup is forbidden from the terminal test entry point"); },
    terminal: async target => {
      const { startTerminalTestServer } = await import("./terminal-test-server");
      await startTerminalTestServer(target);
    },
    checked: async target => {
      const { logger } = await import("./lib/logger");
      logger.info({ mode: "configuration-check-only", host: target.host, database: target.database,
        workers: "not-started", databaseConnected: false }, "Private local terminal test configuration passed");
    },
  });
} catch {
  const { logger } = await import("./lib/logger");
  logger.error("Terminal test startup refused; explicit disposable target and private socket verification are required");
  process.exitCode = 1;
}
