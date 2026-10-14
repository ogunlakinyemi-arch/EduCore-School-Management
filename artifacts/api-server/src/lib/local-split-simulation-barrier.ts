/** Reserved local-only markers. No database, provider or payment dependencies. */
export const LOCAL_SPLIT_SIMULATION_MODE = "LOCAL_SPLIT_SIMULATION";
export const LOCAL_SPLIT_SIMULATION_PATH = "/flutterwave/local-split-simulation";
export class LocalSimulationOperationalUseError extends Error {
  constructor() {
    super("TEST / NOT REAL simulation data cannot be used for recipient verification, operational configuration, checkout, payments or webhooks");
  }
}

export function assertNoLocalSplitSimulation(value: unknown): void {
  const pending: unknown[] = [value], seen = new WeakSet<object>();
  const marker = /LOCAL_SPLIT_SIMULATION|SIMULATION_NOT_REAL_|TEST\s*\/\s*NOT\s*REAL|@fixture\.invalid/i;
  while (pending.length) {
    let item = pending.pop();
    if (Buffer.isBuffer(item)) item = item.toString("utf8");
    if (typeof item === "string") {
      if (marker.test(item)) throw new LocalSimulationOperationalUseError();
      // Decode JSON/raw webhooks too, including escaped marker characters.
      if (/^\s*[\[{]/.test(item)) {
        try { pending.push(JSON.parse(item)); } catch { /* Normal parser/signature checks still apply. */ }
      }
    } else if (item && typeof item === "object" && !seen.has(item)) {
      seen.add(item);
      for (const [key, child] of Object.entries(item)) pending.push(key, child);
    }
  }
}
