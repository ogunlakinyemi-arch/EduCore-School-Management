import {
  terminalTestTarget, verifyTerminalTestSocket, type TerminalTestTarget,
} from "@workspace/db/terminal-test-target";

type Loaders = {
  normal(): Promise<void>;
  terminal(target: TerminalTestTarget): Promise<void>;
  checked(target: TerminalTestTarget): Promise<void>;
};

/** Dependency injection keeps gate tests completely offline, before app/DB imports. */
export async function bootstrapApi(
  env: NodeJS.ProcessEnv,
  args: string[],
  loaders: Loaders,
  verifySocket: (target: TerminalTestTarget) => void = verifyTerminalTestSocket,
) {
  const checkOnly = args.includes("--terminal-test-check");
  const requested = checkOnly || args.includes("--terminal-test") ||
    env.EDUCORE_TERMINAL_TEST_MODE !== undefined;
  if (!requested) { await loaders.normal(); return; }
  const target = terminalTestTarget(env);
  verifySocket(target);
  if (checkOnly) { await loaders.checked(target); return; }
  await loaders.terminal(target);
}
