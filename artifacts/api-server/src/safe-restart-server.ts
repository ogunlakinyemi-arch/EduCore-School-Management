import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { SafeRestartIoGuard } from "./lib/safe-restart-io";
import { safeRestartRequested, SAFE_RESTART_FLAG } from "./lib/safe-restart-policy";

type Request = Pick<IncomingMessage, "method" | "url">;
type Response = Pick<ServerResponse, "statusCode" | "setHeader" | "end">;
type Evidence = { bundleSha256: string; normalBundleSha256: string };

/** Deliberately no normal app/router/SDK/logger imports, nor database access.
 * A GET is not automatically safe: ordinary GET routes can call providers. */
export function safeRestartHandler(guard: SafeRestartIoGuard, evidence: Evidence) {
  return (req: Request, res: Response): void => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("X-EduCore-Runtime-Mode", "development-safe-restart");
    const read = req.method === "GET" || req.method === "HEAD";
    const path = (req.url ?? "").split("?")[0];
    const diagnostics = read && (path === "/api/healthz" || path === "/api/safe-restart/status");
    res.statusCode = diagnostics ? 200 : 503;
    if (!diagnostics) res.setHeader("Retry-After", "60");
    const body = diagnostics ? {
      status: "ok", mode: "development-safe-restart", ...evidence,
      workers: "not-started", database: "not-connected",
      operationalRoutes: "blocked", io: guard.status(),
    } : {
      error: "DEVELOPMENT_SAFE_RESTART_ACTIVE",
      message: "Operational routes, callbacks and external I/O are disabled in Development Safe Restart Mode.",
      retryable: true,
    };
    res.end(req.method === "HEAD" ? undefined : JSON.stringify(body));
  };
}

export async function startSafeRestartServer(
  guard: SafeRestartIoGuard,
  evidence: Evidence,
  env: NodeJS.ProcessEnv = process.env,
) {
  // Defense against direct use outside the guarded bootstrap.
  safeRestartRequested(env, [SAFE_RESTART_FLAG]);
  if (!guard.status().installed || !/^[a-f0-9]{64}$/.test(evidence.bundleSha256)
    || !/^[a-f0-9]{64}$/.test(evidence.normalBundleSha256)) {
    throw new Error("Safe Restart startup requires installed I/O guards and bundle evidence");
  }
  const rawPort = env.PORT;
  if (!rawPort || !/^\d+$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) {
    throw new Error("Safe Restart requires a valid PORT");
  }
  const server = createServer(safeRestartHandler(guard, evidence));
  // No upgrade/tunnel route may bypass the request gate.
  server.on("upgrade", (_req, socket) => socket.destroy());
  server.on("connect", (_req, socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(Number(rawPort), resolve);
  });
  return server;
}
