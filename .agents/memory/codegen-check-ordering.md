---
name: Code generation and verification ordering
description: Avoid false missing-export failures while API client outputs are being regenerated.
---

Finish API code generation and the shared-library build before checking consuming applications or starting browser verification. Do not run checks or live UI journeys concurrently with regeneration.

**Why:** Orval temporarily cleans and rewrites generated outputs. Concurrent typechecks and route tests can report missing established exports. Live Vite pages can also reload against missing modules and become blank, interrupting a valid UI journey.

**How to apply:** Coordinate one code-generation owner, wait for completion, then build shared libraries and verify consuming applications. Freeze generated outputs during browser checks. If regeneration interrupts a live page, restore generation fully, restart the web workflow, and reload before resuming only the interrupted flow. Investigate final exports before renaming hooks.