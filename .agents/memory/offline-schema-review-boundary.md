---
name: Offline schema review boundary
description: Why review tooling must exclude application credentials and distinguish audit output from target validation.
---
Keep offline review tooling credential-free and command-allow-listed. Database-connected review, validation and mutations require a separately approved target/procedure; they must not reuse the ordinary application connection implicitly.

Compiler remediation does not authorize running browser-fixture commands. Validate fixture JSON and ownership helpers with synthetic inputs only unless execution is separately approved.

**Why:** Existing fixture utilities can create/delete Clerk identities and provision/retire database records. Fixing their types is not permission to exercise those operations.

**How to apply:** Keep type checks and pure helper tests separate from fixture CLI execution; retain the approved-target and identity-operation boundaries during software-only remediation.

**Why:** A review-only command policy originally blocked writes but still allowed database-reading CLI commands, while its config required the application URL even for offline generation. The owner authorizes source-only planning when no existing approved disposable target is clearly configured. Test-only Production data does not weaken this boundary.

**How to apply:** Check command policy and credential loading together. Exercise the actual config with credential access forbidden, not just a mocked predicate. Keep full-schema export, executable isolated validation and incremental Publish preview as distinct evidence.

Filtered pnpm commands execute in the package directory, not the workspace root.

**Why:** A workspace-relative report output was resolved inside the scripts package and correctly rejected by the audit-output guard after a missing-output invocation had already been refused. An absolute approved report path avoided changing the guard.

**How to apply:** Resolve review-output paths from the intended workspace root before invoking package commands. Never weaken path/symlink checks merely to accept a misplaced output.

Publish does not support selecting individual statements from the Development-to-Production schema diff.

**Why:** The user explicitly reported Replit Support confirmation of this limitation. A five-statement allowlist or edited offline export cannot isolate a release when the actual Development schema contains additional differences.

**How to apply:** Obtain a fresh read-only preview when authorized, and treat statement numbers as capture-specific. If the actual release baseline is not safe, stop before mutations unless a Production-compatible code/schema baseline and a verified recovery path for current Development are established. Do not repeat generic backup-tool builds or broad audits to rediscover this limitation.

Keep strict clean-environment gates intact when combining native tests with
TypeScript loaders; choose a compatible invocation rather than expanding the
allowlist for runner-injected state.

**Why:** An unwrapped, clean Node invocation with `--test` plus the tsx loader
failed the native export regression's environment gate before initialization.
Direct invocation with that loader passed the unchanged gate and still ran the
`node:test` harness.

**How to apply:** For explicitly authorized disposable tests requiring schema
TypeScript imports, use the documented direct clean-Node command. Keep ordinary
offline tests on their existing runner, and never treat a loader problem as
permission to inherit application configuration or select a different database.
