---
name: Code generation and verification ordering
description: Avoid false missing-export failures while API client outputs are being regenerated.
---

Finish API code generation and the shared-library build before checking consuming applications. Do not run those checks concurrently with a helper regenerating the same client.

**Why:** Orval temporarily cleans and rewrites generated outputs. A concurrent application typecheck reported missing established authentication, employee-NFC and transport hooks even though the completed generated client contained them all.

**How to apply:** Coordinate one code-generation owner, wait for completion, then build shared libraries and verify consuming applications. Investigate the final generated exports before changing or renaming application hooks in response to a missing-export error.