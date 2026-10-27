---
name: API code-generation constraints
description: Generation ordering and external OpenAPI reference limitations.
---

Finish API code generation and the shared-library build before checking consuming applications or starting browser verification. Do not run checks or live UI journeys concurrently with regeneration.

**Why:** Orval temporarily cleans and rewrites generated outputs. Concurrent typechecks and route tests can report missing established exports. Live Vite pages can also reload against missing modules and become blank, interrupting a valid UI journey.

**How to apply:** Coordinate one code-generation owner, wait for completion, then build shared libraries and verify consuming applications. Freeze generated outputs during browser checks. If regeneration interrupts a live page, restore generation fully, restart the web workflow, and reload before resuming only the interrupted flow. Investigate final exports before renaming hooks.

## Referenced OpenAPI schemas

Public SDK type exports must be maintained in the generation workflow, not only
the generated entrypoint.

**Why:** A later contract regeneration can overwrite manually added public type
exports and break an unrelated, previously verified feature.

**How to apply:** Update the entrypoint generator when adding a public type
export and check consumer typechecks after regeneration.

Avoid YAML anchors and aliases in separately referenced OpenAPI files; expand the reused definitions inline.

**Why:** The project's Orval reference resolver failed on anchors in an external Exam/Record contract, while equivalent expanded definitions generated successfully.

**How to apply:** Keep external contracts explicit and confirm code generation before checking their consuming applications.

## Distinguish generation from declaration verification

Generated-source success and passing frontend/API checks do not prove that the
shared validation library's declaration build completed.

**Why:** The generation command can finish writing both clients and validators,
then stall in the subsequent shared-library build while consuming-app checks
still pass. Treating its earlier success messages as full completion hides an
unverified build gate.

**How to apply:** Inspect the final command result and the specific build stage.
If a bounded shared build cannot complete, report that limitation separately
from passing source checks; do not keep regenerating unchanged outputs or claim
that all build gates passed.

## Calendar-only inputs must retain their original spelling

Validate calendar-only finance inputs as strings before converting them to
timestamps. Use explicit lexical and real-calendar validation when overflow
dates must be rejected.

**Why:** The current generator turns OpenAPI `format: date` into a coercing
JavaScript Date validator. That can change the input type and normalize invalid
calendar dates before a business validator sees the original value. SQL `date`
values can also lose a day when a local-midnight Date is formatted through UTC.

**How to apply:** Inspect the generated date boundary when adding date-only
rules. Preserve the original date spelling for strict checks; obtain authoritative
SQL calendar values as text rather than round-tripping through timestamps.