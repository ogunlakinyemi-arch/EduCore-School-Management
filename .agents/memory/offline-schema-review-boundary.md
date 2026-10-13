---
name: Offline schema review boundary
description: Why review tooling must exclude application credentials and distinguish audit output from target validation.
---
Keep offline review tooling credential-free and command-allow-listed. Database-connected review, validation and mutations require a separately approved target/procedure; they must not reuse the ordinary application connection implicitly.

**Why:** A review-only command policy originally blocked writes but still allowed database-reading CLI commands, while its config required the application URL even for offline generation. The owner authorizes source-only planning when no existing approved disposable target is clearly configured. Test-only Production data does not weaken this boundary.

**How to apply:** Check command policy and credential loading together. Exercise the actual config with credential access forbidden, not just a mocked predicate. Keep full-schema export, executable isolated validation and incremental Publish preview as distinct evidence.

Filtered pnpm commands execute in the package directory, not the workspace root.

**Why:** A workspace-relative report output was resolved inside the scripts package and correctly rejected by the audit-output guard after a missing-output invocation had already been refused. An absolute approved report path avoided changing the guard.

**How to apply:** Resolve review-output paths from the intended workspace root before invoking package commands. Never weaken path/symlink checks merely to accept a misplaced output.
