import pg from "pg";
import { createHash } from "node:crypto";

/**
 * Connection resilience for the shared application pool.
 *
 * Safety rules:
 * - Only connection *establishment* (`pool.connect()` before any SQL is sent)
 *   is retried, and only for clearly transient failures. Queries, writes and
 *   transactions are never replayed here.
 * - Authentication/permission failures (SQLSTATE class 28, 42501) are never
 *   retried or treated as success.
 * - Diagnostics are allowlisted: SQLSTATE, a fixed category and a fixed
 *   message. Raw driver errors, connection strings, usernames, hostnames, SQL
 *   parameters and user data are never reported.
 */

export type DatabaseErrorCategory =
  | "CONNECTION_TERMINATED"
  | "CONNECTION_UNAVAILABLE"
  | "CONNECT_TIMEOUT"
  | "AUTHENTICATION_REJECTED"
  | "PERMISSION_DENIED"
  | "DATABASE_ERROR"
  | "NON_DATABASE_ERROR";

export interface DatabaseErrorDiagnostic {
  sqlstate: string | null;
  networkCode: string | null;
  category: DatabaseErrorCategory;
  message: string;
  transientConnectFailure: boolean;
  authorizationReason: "PASSWORD_REJECTED" | "ROLE_UNAVAILABLE" | "ACCESS_RULE_REJECTED" | "UNSPECIFIED" | null;
}

const CATEGORY_MESSAGE: Record<DatabaseErrorCategory, string> = {
  CONNECTION_TERMINATED: "The database closed the connection",
  CONNECTION_UNAVAILABLE: "The database could not be reached or is not accepting connections",
  CONNECT_TIMEOUT: "Timed out acquiring a database connection",
  AUTHENTICATION_REJECTED: "The database rejected the connection's authorization",
  PERMISSION_DENIED: "The database denied permission for the operation",
  DATABASE_ERROR: "The database reported an error",
  NON_DATABASE_ERROR: "A non-database error occurred",
};

const TERMINATED_SQLSTATES = new Set(["57P01", "57P02", "08006", "08003"]);
const UNAVAILABLE_SQLSTATES = new Set(["57P03", "08000", "08001"]);
const NETWORK_CODES = new Set([
  "ECONNRESET", "ECONNREFUSED", "EPIPE", "ETIMEDOUT", "EHOSTUNREACH",
  "ENETUNREACH", "EAI_AGAIN", "ENOTFOUND",
]);
// Fixed pg/pg-pool texts used only for matching; never copied into diagnostics.
const TERMINATED_TEXT = /^Connection terminated( unexpectedly)?$|^Client has encountered a connection error and is not queryable$/;
const TIMEOUT_TEXT = /^timeout exceeded when trying to connect$|^Connection terminated due to connection timeout$/;

function field(error: unknown, name: string): unknown {
  return error !== null && typeof error === "object" ? (error as Record<string, unknown>)[name] : undefined;
}

export function classifyDatabaseError(error: unknown): DatabaseErrorDiagnostic {
  const rawCode = field(error, "code");
  const code = typeof rawCode === "string" ? rawCode : null;
  const sqlstate = code && /^[0-9A-Z]{5}$/.test(code) ? code : null;
  const networkCode = code && NETWORK_CODES.has(code) ? code : null;
  const text = error instanceof Error ? error.message : "";
  let category: DatabaseErrorCategory;
  if (sqlstate?.startsWith("28")) category = "AUTHENTICATION_REJECTED";
  else if (sqlstate === "42501") category = "PERMISSION_DENIED";
  else if (sqlstate && TERMINATED_SQLSTATES.has(sqlstate)) category = "CONNECTION_TERMINATED";
  else if (sqlstate && UNAVAILABLE_SQLSTATES.has(sqlstate)) category = "CONNECTION_UNAVAILABLE";
  else if (sqlstate) category = "DATABASE_ERROR";
  else if (networkCode) category = "CONNECTION_UNAVAILABLE";
  else if (TIMEOUT_TEXT.test(text)) category = "CONNECT_TIMEOUT";
  else if (TERMINATED_TEXT.test(text)) category = "CONNECTION_TERMINATED";
  else category = "NON_DATABASE_ERROR";
  return {
    sqlstate,
    networkCode,
    category,
    message: CATEGORY_MESSAGE[category],
    // Match known driver/server wording internally; never copy it into logs.
    authorizationReason: category !== "AUTHENTICATION_REJECTED" ? null
      : /password authentication failed/i.test(text) ? "PASSWORD_REJECTED"
      : /role .*does not exist|role .*not permitted to log in/i.test(text) ? "ROLE_UNAVAILABLE"
      : /no pg_hba.conf entry|pg_hba.conf rejects connection/i.test(text) ? "ACCESS_RULE_REJECTED"
      : "UNSPECIFIED",
    // A timeout has already waited the full bound, so it is not retried.
    transientConnectFailure: category === "CONNECTION_TERMINATED" || category === "CONNECTION_UNAVAILABLE",
  };
}

export type DatabaseDiagnosticReporter = (
  event: "IDLE_CLIENT_ERROR" | "CHECKED_OUT_CLIENT_ERROR" | "CONNECT_RETRY",
  diagnostic: DatabaseErrorDiagnostic & { attempt?: number },
) => void;

let reporter: DatabaseDiagnosticReporter = (event, diagnostic) => {
  console.warn(JSON.stringify({ databaseDiagnostic: { event, ...diagnostic } }));
};

/** Lets the API route sanitized pool diagnostics into its structured logger. */
export function setDatabaseDiagnosticReporter(next: DatabaseDiagnosticReporter) {
  reporter = next;
}

function report(...args: Parameters<DatabaseDiagnosticReporter>) {
  try { reporter(...args); } catch { /* diagnostics must never crash the process */ }
}

export const CONNECT_TIMEOUT_MS = 10_000;
export const CONNECT_RETRY_DELAYS_MS = [250, 1_000] as const;

type PoolLike = {
  on(event: "error", listener: (error: Error) => void): unknown;
};

/**
 * Prevents a single dropped idle connection from crashing the process.
 * pg-pool has already removed the dead client before emitting; the next
 * acquisition opens a fresh connection.
 */
export function attachPoolErrorHandler(pool: PoolLike) {
  pool.on("error", (error) => report("IDLE_CLIENT_ERROR", classifyDatabaseError(error)));
}

const guardedClients = new WeakSet<object>();

/** A checked-out client between queries otherwise has no 'error' listener. */
function guardCheckedOutClient(client: pg.PoolClient) {
  if (guardedClients.has(client)) return;
  guardedClients.add(client);
  client.on("error", (error: Error) => {
    // While idle, pg-pool's own listener handles and reports the error.
    if (checkedOut.has(client)) report("CHECKED_OUT_CLIENT_ERROR", classifyDatabaseError(error));
  });
}
const checkedOut = new WeakSet<object>();

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Acquire a client, retrying only clearly transient establishment failures.
 * No SQL has been sent when these errors occur, so retrying cannot duplicate a write.
 */
export async function connectWithRetry(
  acquire: () => Promise<pg.PoolClient>,
  delays: readonly number[] = CONNECT_RETRY_DELAYS_MS,
  wait: (ms: number) => Promise<void> = sleep,
): Promise<pg.PoolClient> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      const client = await acquire();
      guardCheckedOutClient(client);
      checkedOut.add(client);
      const release = client.release;
      client.release = ((err?: Error | boolean) => {
        checkedOut.delete(client);
        return release.call(client, err);
      }) as typeof client.release;
      return client;
    } catch (error) {
      const diagnostic = classifyDatabaseError(error);
      if (!diagnostic.transientConnectFailure || attempt >= delays.length) throw error;
      report("CONNECT_RETRY", { ...diagnostic, attempt: attempt + 1 });
      await wait(delays[attempt]);
    }
  }
}

/** Pool whose promise-form connect() retries transient establishment failures. */
export class ResilientPool extends pg.Pool {
  readonly targetDiagnostic: ReturnType<typeof databaseTargetDiagnostic>;
  constructor(options: pg.PoolConfig) {
    super({ connectionTimeoutMillis: CONNECT_TIMEOUT_MS, ...options });
    this.targetDiagnostic = databaseTargetDiagnostic(options);
    attachPoolErrorHandler(this);
  }

  connect(): Promise<pg.PoolClient>;
  connect(callback: (err: Error | undefined, client: pg.PoolClient | undefined, done: (release?: unknown) => void) => void): void;
  connect(callback?: (...args: any[]) => void): Promise<pg.PoolClient> | void {
    // pool.query() uses the callback form internally; it is left unchanged so
    // single statements are never replayed by this layer.
    if (callback) return super.connect(callback);
    return connectWithRetry(() => super.connect());
  }
}

/** Resolves the same pg configuration without connecting or reading passwords.
 * Only public routing fields enter the digest. No URL, hostname, database/user
 * name or credential is returned; this identifies configuration, not DB health.
 */
export function databaseTargetDiagnostic(options: pg.PoolConfig) {
  try {
    const parameters = (new pg.Client(options) as pg.Client & {
      connectionParameters: {host: string; port: number; database: string};
    }).connectionParameters;
    const host = String(parameters.host);
    return Object.freeze({
      targetFingerprint: createHash("sha256").update(JSON.stringify([
        host.toLowerCase(), Number(parameters.port), String(parameters.database),
      ])).digest("hex").slice(0,24),
      endpointType: host.startsWith("/") ? "UNIX_SOCKET" : "TCP",
      providerHint: /(?:^|\.)neon\.tech$/i.test(host) ? "NEON_HOSTNAME" : "UNDETERMINED",
      connectedTargetVerified: false as const,
    });
  } catch {
    return Object.freeze({targetFingerprint:null,endpointType:"UNAVAILABLE",
      providerHint:"UNDETERMINED",connectedTargetVerified:false as const});
  }
}
