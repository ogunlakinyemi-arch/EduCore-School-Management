import { lstatSync, realpathSync } from "node:fs";

export type TerminalTestTarget = {
  name: string;
  host: string;
  database: string;
  user: string;
  port: number;
  httpPort: number;
};

/** Non-secret configuration only. Never consult DATABASE_URL or PG credentials. */
export function terminalTestTarget(env: NodeJS.ProcessEnv): TerminalTestTarget {
  if (env.EDUCORE_TERMINAL_TEST_MODE !== "isolated" ||
      env.NODE_ENV !== "development" || env.REPLIT_DEPLOYMENT !== undefined ||
      env.EDUCORE_DEVELOPMENT_WORKERS_PAUSED !== "true" ||
      env.EDUCORE_TERMINAL_TEST_CONFIRM !== "DISPOSABLE_LOCAL_ONLY") {
    throw new Error("Terminal test mode requires explicit isolated Development configuration and paused workers");
  }
  const name = env.EDUCORE_TERMINAL_TEST_TARGET;
  if (!name || !/^[a-z][a-z0-9_]{0,31}$/.test(name)) {
    throw new Error("An explicit terminal test target name is required");
  }
  const host = `/tmp/educore-terminal-test-${name}`;
  const database = `educore_terminal_test_${name}`;
  if (env.EDUCORE_TERMINAL_TEST_DB_HOST !== host ||
      env.EDUCORE_TERMINAL_TEST_DB_NAME !== database ||
      env.EDUCORE_TERMINAL_TEST_DB_USER !== "educore_terminal_test") {
    throw new Error("Terminal test database must match the named private local target");
  }
  const parsePort = (value: string | undefined) => {
    if (!value || !/^\d{4,5}$/.test(value) || Number(value) < 1024 || Number(value) > 65535) {
      throw new Error("Explicit non-privileged terminal test ports are required");
    }
    return Number(value);
  };
  const port = parsePort(env.EDUCORE_TERMINAL_TEST_DB_PORT);
  const httpPort = parsePort(env.EDUCORE_TERMINAL_TEST_HTTP_PORT);
  if (httpPort === port || httpPort === 8080 || httpPort === Number(env.PORT)) {
    throw new Error("Terminal test HTTP port must be separate from the preview and database ports");
  }
  return { name, host, database, user: "educore_terminal_test", port, httpPort };
}

/** Filesystem-only check. Does not open a socket, authenticate or query PostgreSQL. */
export function verifyTerminalTestSocket(target: TerminalTestTarget) {
  const directory = lstatSync(target.host);
  const socket = lstatSync(`${target.host}/.s.PGSQL.${target.port}`);
  const uid = process.getuid?.();
  if (uid === undefined || !directory.isDirectory() || directory.isSymbolicLink() ||
      directory.uid !== uid || (directory.mode & 0o077) !== 0 ||
      realpathSync(target.host) !== target.host ||
      !socket.isSocket() || socket.isSymbolicLink() || socket.uid !== uid) {
    throw new Error("Terminal test socket must belong to this user in its private, non-symlink directory");
  }
}

export function terminalTestPoolOptions(target: TerminalTestTarget) {
  return {
    host: target.host, database: target.database, user: target.user, port: target.port,
    // A truthy callback prevents pg from falling back to inherited PGPASSWORD.
    // The separately provisioned disposable local cluster must permit this test role.
    password: () => "",
    ssl: false as const,
    connectionTimeoutMillis: 2000,
    max: 4,
    application_name: "educore-isolated-terminal-test",
  };
}
