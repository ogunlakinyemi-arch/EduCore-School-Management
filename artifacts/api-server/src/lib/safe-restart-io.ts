import { createRequire, syncBuiltinESMExports } from "node:module";

export type SafeRestartIoStatus = Readonly<{
  installed: true;
  isolation: "in-process-not-os";
  rejectedAttempts: number;
}>;
export type SafeRestartIoGuard = { status(): SafeRestartIoStatus };
export type DenyBoundary = {
  name: string;
  target: object;
  key: string;
  asynchronous?: boolean;
};
export class SafeRestartIoError extends Error {
  readonly code = "DEVELOPMENT_SAFE_RESTART_IO_BLOCKED";
  constructor() { super("External I/O is disabled in Development Safe Restart Mode"); }
}

/** No restore switch: this process must exit to leave safe mode. Arguments allow
 * credential-free fixture testing, not environment/provider-based exceptions. */
export function applySafeRestartIoGuards(boundaries: readonly DenyBoundary[]): SafeRestartIoGuard {
  let rejectedAttempts = 0;
  // Refuse incomplete installation before an application can be loaded.
  for (const boundary of boundaries) {
    const descriptor = Object.getOwnPropertyDescriptor(boundary.target, boundary.key);
    if (!descriptor || typeof descriptor.value !== "function" || !descriptor.writable) {
      throw new Error(`Cannot install Safe Restart boundary: ${boundary.name}`);
    }
  }
  for (const boundary of boundaries) {
    function reject() {
      rejectedAttempts++;
      throw new SafeRestartIoError();
    }
    Object.defineProperty(boundary.target, boundary.key, {
      value: boundary.asynchronous ? async () => reject() : reject,
      writable: false,
      configurable: false,
    });
  }
  return { status: () => Object.freeze({
    installed: true, isolation: "in-process-not-os", rejectedAttempts,
  }) };
}

/** Built-ins only. No application, SDK, database, logger or provider imports.
 * This is defense in depth, NOT a kernel firewall or hostile-code sandbox. */
export function safeRestartIoBoundaries(): DenyBoundary[] {
  const require = createRequire(import.meta.url);
  const boundaries: DenyBoundary[] = [
    { name: "fetch", target: globalThis, key: "fetch", asynchronous: true },
    { name: "application interval", target: globalThis, key: "setInterval" },
  ];
  const methods = (module: string, keys: string[], asynchronous = false) => {
    const target = require(`node:${module}`);
    for (const key of keys) boundaries.push({ name: `${module}.${key}`, target, key, asynchronous });
    return target;
  };
  methods("http", ["request", "get"]);
  methods("https", ["request", "get"]);
  methods("http2", ["connect"]);
  const net = methods("net", ["connect", "createConnection"]);
  boundaries.push({ name: "socket.connect", target: net.Socket.prototype, key: "connect" });
  methods("tls", ["connect"]);
  const udp = require("node:dgram");
  for (const key of ["connect", "send"]) {
    boundaries.push({ name: `datagram.${key}`, target: udp.Socket.prototype, key });
  }
  const dns = methods("dns", ["Resolver", "lookup", "lookupService", "resolve", "resolve4", "resolve6",
    "resolveAny", "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs",
    "resolvePtr", "resolveSoa", "resolveSrv", "resolveTxt", "reverse"]);
  for (const key of ["lookup", "lookupService", "resolve", "resolve4", "resolve6", "resolveAny",
    "resolveCaa", "resolveCname", "resolveMx", "resolveNaptr", "resolveNs", "resolvePtr",
    "resolveSoa", "resolveSrv", "resolveTxt", "reverse"]) {
    boundaries.push({ name: `dns.promises.${key}`, target: dns.promises, key, asynchronous: true });
  }
  boundaries.push({ name: "dns.promises.Resolver", target: dns.promises, key: "Resolver" });
  methods("timers", ["setInterval"]);
  methods("timers/promises", ["setInterval"]);
  methods("child_process", ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]);
  methods("worker_threads", ["Worker"]);
  return boundaries;
}

export function installSafeRestartIoGuards(): SafeRestartIoGuard {
  const guard = applySafeRestartIoGuards(safeRestartIoBoundaries());
  syncBuiltinESMExports();
  return guard;
}
