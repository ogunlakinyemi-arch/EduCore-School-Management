// Constructor-only entry point for explicitly isolated databases. No application
// pool, schema import, environment lookup, or connection is performed here.
export { Pool as DatabasePool, Client as DatabaseClient } from "pg";
export type { PoolClient as DatabasePoolClient } from "pg";
