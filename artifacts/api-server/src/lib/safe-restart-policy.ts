export const SAFE_RESTART_FLAG = "--development-safe-restart";

/** A command-line opt-in only. Never infer safety from notification settings. */
export function safeRestartRequested(env: NodeJS.ProcessEnv, args: readonly string[]): boolean {
  // A misspelled safety argument must not accidentally select ordinary startup.
  const known = new Set([SAFE_RESTART_FLAG, "--terminal-test", "--terminal-test-check"]);
  if (args.some(arg => !known.has(arg))) throw new Error("Unrecognized API startup option");
  const matching = args.filter(arg => arg.startsWith(SAFE_RESTART_FLAG));
  if (!matching.length) return false;
  if (matching.length !== 1 || matching[0] !== SAFE_RESTART_FLAG) {
    throw new Error("Invalid Development Safe Restart option");
  }
  if (env.NODE_ENV !== "development" || env.REPLIT_DEPLOYMENT !== undefined) {
    throw new Error("Safe Restart Mode is restricted to unpublished Development");
  }
  if (env.EDUCORE_TERMINAL_TEST_MODE !== undefined || args.some(arg => arg.startsWith("--terminal-test"))) {
    throw new Error("Safe Restart Mode cannot be combined with terminal test mode");
  }
  return true;
}
