import { describe, expect, it, vi } from "vitest";
import { createIndependentBackgroundTasks } from "./background-task";

describe("independent background tasks", () => {
  it("lets delivery run when maintenance fails and retries only on the next tick", async () => {
    const maintenance = vi.fn(async () => { throw new Error("private fixture error"); });
    const delivery = vi.fn(async () => {});
    const logger = { error: vi.fn() };
    const tick = createIndependentBackgroundTasks([
      { name: "maintenance", run: maintenance }, { name: "delivery", run: delivery },
    ], logger);
    expect(await tick()).toEqual(["failed", "succeeded"]);
    expect(delivery).toHaveBeenCalledOnce();
    expect(JSON.stringify(logger.error.mock.calls)).not.toContain("private fixture error");
    await tick();
    expect(maintenance).toHaveBeenCalledTimes(2);
    expect(delivery).toHaveBeenCalledTimes(2);
  });

  it("skips overlapping maintenance while allowing a completed delivery task to run again", async () => {
    let finish!: () => void;
    const maintenance = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
    const delivery = vi.fn(async () => {});
    const tick = createIndependentBackgroundTasks([
      { name: "maintenance", run: maintenance }, { name: "delivery", run: delivery },
    ], { error: vi.fn() });
    const first = tick();
    await Promise.resolve();
    expect(await tick()).toEqual(["skipped", "succeeded"]);
    expect(maintenance).toHaveBeenCalledOnce();
    expect(delivery).toHaveBeenCalledTimes(2);
    finish();
    await first;
  });
});
