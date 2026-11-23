import {
  terminalTestTarget, verifyTerminalTestSocket, type TerminalTestTarget,
} from "@workspace/db/terminal-test-target";
import { safeRestartRequested } from "./safe-restart-policy";
import { installSafeRestartIoGuards, type SafeRestartIoGuard } from "./safe-restart-io";

type Loaders = {
  normal(): Promise<void>;
  safe?(guard: SafeRestartIoGuard): Promise<void>;
  terminal(target: TerminalTestTarget): Promise<void>;
  checked(target: TerminalTestTarget): Promise<void>;
};

/** Dependency injection keeps gate tests completely offline, before app/DB imports. */
export async function bootstrapApi(
  env: NodeJS.ProcessEnv,
  args: string[],
  loaders: Loaders,
  verifySocket: (target: TerminalTestTarget) => void = verifyTerminalTestSocket,
  installIoGuard: () => SafeRestartIoGuard = installSafeRestartIoGuards,
) {
  if (safeRestartRequested(env, args)) {
    if (!loaders.safe) throw new Error("Safe Restart loader is unavailable; refusing normal startup");
    const guard = installIoGuard();
    await loaders.safe(guard);
    return;
  }
  const checkOnly = args.includes("--terminal-test-check");
  const requested = checkOnly || args.includes("--terminal-test") ||
    env.EDUCORE_TERMINAL_TEST_MODE !== undefined;
  if (!requested) { await loaders.normal(); return; }
  const target = terminalTestTarget(env);
  verifySocket(target);
  if (checkOnly) { await loaders.checked(target); return; }
  await loaders.terminal(target);
}
