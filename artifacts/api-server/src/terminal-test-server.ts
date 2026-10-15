import express from "express";
import type { TerminalTestTarget } from "@workspace/db/terminal-test-target";

/** Imported only after the configuration/filesystem gate passes. No startup jobs. */
export async function startTerminalTestServer(target: TerminalTestTarget) {
  const { default: terminalRouter } = await import("./routes/terminal-events");
  const { logger } = await import("./lib/logger");
  const app = express();
  app.disable("x-powered-by");
  app.get("/api/healthz", (_req, res) => {
    res.json({ status: "ok", mode: "isolated-terminal-test", workers: "disabled" });
  });
  app.use("/api", terminalRouter);
  // No Clerk/user portal, finance routes, dispatchers or database identity probes.
  await new Promise<void>((resolve, reject) => {
    app.listen(target.httpPort, "127.0.0.1", error => {
      if (error) { reject(error); return; }
      logger.info({ mode: "isolated-terminal-test", host: target.host, database: target.database,
        port: target.httpPort, workers: "disabled" }, "Local terminal test server listening; no startup SQL");
      resolve();
    });
  });
}
