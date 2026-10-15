import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import { terminalTestTarget, verifyTerminalTestSocket, terminalTestPoolOptions } from "./terminal-test-target";

const { Pool } = pg;

function connectionOptions() {
  // Any supplied test-mode value opts out of the shared credential entirely.
  // A typo must fail closed, never silently fall back to DATABASE_URL.
  if (process.env.EDUCORE_TERMINAL_TEST_MODE !== undefined) {
    const target = terminalTestTarget(process.env);
    verifyTerminalTestSocket(target);
    return terminalTestPoolOptions(target);
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
  }
  return { connectionString: process.env.DATABASE_URL };
}

// Pool construction is lazy; startup performs no connection or SQL.
export const pool = new Pool(connectionOptions());
export const db = drizzle(pool, { schema });

export * from "./schema";
// Driver constructors/types let consumers inspect connection metadata or use
// isolated test pools without introducing a second application DB connection.
export { Client as DatabaseClient, Pool as DatabasePool } from "pg";
export type { PoolClient as DatabasePoolClient } from "pg";
