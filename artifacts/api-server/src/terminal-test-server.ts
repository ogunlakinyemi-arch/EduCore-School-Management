import express from "express";
import type { TerminalTestTarget } from "@workspace/db/terminal-test-target";

/** Imported only after the configuration/filesystem gate passes. No startup jobs. */
export async function startTerminalTestServer(target: TerminalTestTarget) {
  const { default: terminalRouter } = await import("./routes/terminal-events");
  const { logger } = await import("./lib/logger");
  const app = express();
  app.disable("x-powered-by");
  // Bound memory and request rate for the temporary publicly reachable service.
  const clients = new Map<string, { since: number; count: number }>();
  app.use((req, res, next) => {
    const key = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    let client = clients.get(key);
    if (!client || now - client.since >= 60_000) {
      if (clients.size >= 1024) clients.clear();
      client = { since: now, count: 0 };
      clients.set(key, client);
    }
    if (++client.count > 120) {
      res.set("Retry-After", "60").status(429).json({ success: false, retryable: true, message: "Test service rate limit" });
      return;
    }
    next();
  });
  app.get(`${target.apiBasePath}/healthz`, (_req, res) => {
    res.json({ status: "ok", mode: "isolated-terminal-test", workers: "disabled" });
  });
  app.use(target.apiBasePath, terminalRouter);
  app.use((_req, res) => { res.status(404).json({ error: "Terminal test route not found" }); });
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
