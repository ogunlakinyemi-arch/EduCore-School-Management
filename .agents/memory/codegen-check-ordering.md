---
name: API code-generation constraints
description: Generation ordering and external OpenAPI reference limitations.
---

Finish API code generation and the shared-library build before checking consuming applications or starting browser verification. Do not run checks or live UI journeys concurrently with regeneration.

**Why:** Orval temporarily cleans and rewrites generated outputs. Concurrent typechecks and route tests can report missing established exports. Live Vite pages can also reload against missing modules and become blank, interrupting a valid UI journey.

**How to apply:** Coordinate one code-generation owner, wait for completion, then build shared libraries and verify consuming applications. Freeze generated outputs during browser checks. If regeneration interrupts a live page, restore generation fully, restart the web workflow, and reload before resuming only the interrupted flow. Investigate final exports before renaming hooks.

## Referenced OpenAPI schemas

Avoid YAML anchors and aliases in separately referenced OpenAPI files; expand the reused definitions inline.

**Why:** The project's Orval reference resolver failed on anchors in an external Exam/Record contract, while equivalent expanded definitions generated successfully.

**How to apply:** Keep external contracts explicit and confirm code generation before checking their consuming applications.