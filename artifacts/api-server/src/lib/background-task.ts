import { classifyDatabaseError } from "@workspace/db/connection-resilience";

type TaskLogger = { error: (fields: Record<string, unknown>, message: string) => void };

/**
 * One guarded run per tick: overlapping ticks are skipped, a failed run is
 * not retried inside the tick (its jobs may not be idempotent), and the next
 * scheduled tick is the only retry. Failures are logged with allowlisted
 * diagnostics only, never the raw driver error.
 */
export function createGuardedBackgroundTask(
  name: string,
  run: () => Promise<void>,
  logger: TaskLogger,
) {
  let running = false;
  return async function tick(): Promise<"skipped" | "succeeded" | "failed"> {
    if (running) return "skipped";
    running = true;
    try {
      await run();
      return "succeeded";
    } catch (error) {
      const diagnostic = classifyDatabaseError(error);
      logger.error({
        task: name,
        sqlstate: diagnostic.sqlstate,
        networkCode: diagnostic.networkCode,
        category: diagnostic.category,
        reason: diagnostic.message,
      }, `${name} failed`);
      return "failed";
    } finally {
      running = false;
    }
  };
}
