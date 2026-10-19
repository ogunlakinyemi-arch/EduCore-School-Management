import fs from "node:fs/promises";
import { constants } from "node:fs";

// Trusted operator attestation, never generated from the candidate connection.
export const paymentBindingPath = "/home/runner/.config/educore/development-payment-diagnostic.json";
export const paymentIdentitySql = `SELECT current_database() AS database,
 (SELECT oid::text FROM pg_database WHERE datname=current_database()) AS database_oid,
 (SELECT system_identifier::text FROM pg_control_system()) AS system_identifier,
 current_setting('data_directory') AS data_directory,
 to_char(pg_postmaster_start_time() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS server_started,
 inet_server_addr()::text AS server_address, current_setting('port') AS port,
 current_user AS role, current_setting('server_version_num') AS server_version_num,
 pg_is_in_recovery() AS in_recovery,
 (SELECT pg_encoding_to_char(encoding) FROM pg_database WHERE datname=current_database()) AS encoding,
 (SELECT datcollate FROM pg_database WHERE datname=current_database()) AS collate,
 (SELECT datctype FROM pg_database WHERE datname=current_database()) AS ctype,
 (SELECT datlocprovider::text FROM pg_database WHERE datname=current_database()) AS locale_provider`;
const fields = ["database","database_oid","system_identifier","data_directory","server_started",
  "server_address","port","role","server_version_num","in_recovery","encoding","collate","ctype","locale_provider"];

export class DiagnosticError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}
export function assertDiagnosticDevelopment(env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "development" || env.REPLIT_ENVIRONMENT === "production"
      || Object.hasOwn(env,"REPLIT_DEPLOYMENT") || Object.hasOwn(env,"REPLIT_DEPLOYMENT_ID")) {
    throw new DiagnosticError(404,"DEVELOPMENT_DIAGNOSTIC_UNAVAILABLE");
  }
}
export function validatePaymentBinding(proof: any, now = Date.now()) {
  const date = Date.parse(proof?.verifiedAt);
  const i = proof?.identity;
  if (proof?.environment !== "development" || proof?.verifiedBy !== "replit-development-read-only"
      || !Number.isFinite(date) || date > now || now-date > 30*60_000
      || !i || !fields.every(k => Object.hasOwn(i,k)
        && (i[k] === null || ["string","boolean","number"].includes(typeof i[k])))
      || i.in_recovery !== false || i.server_address !== null
      || !/^\d+$/.test(i.system_identifier) || !/^\d+$/.test(i.database_oid)
      || !String(i.data_directory).startsWith("/")
      || [i.database,i.data_directory].some(v => /(?:production|(?:^|[\/_-])prod(?:$|[\/_-]))/i.test(String(v)))) {
    throw new DiagnosticError(503,"INDEPENDENT_DEVELOPMENT_BINDING_REQUIRED");
  }
  return i as Record<string, unknown>;
}
export function assertPaymentBinding(expected: Record<string, unknown>, actual: Record<string, unknown>) {
  if (!fields.every(k => Object.hasOwn(actual,k) && actual[k] === expected[k])) {
    throw new DiagnosticError(503,"DEVELOPMENT_BINDING_MISMATCH");
  }
}
export async function readPaymentBinding() {
  try {
    if (await fs.realpath(paymentBindingPath) !== paymentBindingPath) throw new Error();
    const file = await fs.open(paymentBindingPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 16_384 || (stat.mode & 0o777) !== 0o600
          || stat.uid !== process.getuid?.()) throw new Error();
      return validatePaymentBinding(JSON.parse(await file.readFile("utf8")));
    } finally { await file.close(); }
  } catch {
    throw new DiagnosticError(503,"INDEPENDENT_DEVELOPMENT_BINDING_REQUIRED");
  }
}
