---
name: Mutation cleanup ownership
description: Reliable release of per-record in-flight guards with TanStack Query mutation observer changes.
---

Per-record in-flight guards must release through the individual execution promise's `finally`, or through mutation-level callbacks that reliably receive that execution's variables. Do not rely on callbacks passed to an individual `mutate` call for essential cleanup.

**Why:** TanStack Query's mutation observer can detach from an earlier execution when another mutation starts or the observer resets. Per-call settlement callbacks can then be skipped, leaving a record permanently marked busy despite a completed request. Mocked mutation hooks can hide this behavior.

**How to apply:** Capture the selected record's key before calling `mutateAsync`, clean up that exact key in `finally`, and handle rejection. Test overlapping requests and resets using real mutation observers, without real provider or database calls.