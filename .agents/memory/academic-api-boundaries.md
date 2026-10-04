---
name: Academic API boundaries
description: DTO fixtures, authorization-aware choices, date coercion and optional remarks need real boundary evidence.
---

Validate calendar components before date coercion, while accepting the exact midnight-UTC serialization used by existing date-only forms. Test both raw date-only strings and the form's serialized payload.

**Why:** Generated SDK coercion can normalize an impossible calendar date before validation. Rejecting every ISO timestamp instead also rejects valid submissions from the existing forms.

**How to apply:** When changing academic date validation or code generation, check the actual form-to-request boundary rather than relying only on direct API calls.

Treat a blank optional result comment consistently with an omitted comment and the school's configured grading remark; do not weaken mandatory grading-policy or correction-reason fields.

**Why:** Native requests omitted optional remarks, while the real teacher form sent an empty string. The native flow passed but genuine browser saves failed.

**How to apply:** Include blank optional fields in regression payloads when the UI sends them. Preserve the distinction between omission meaning “leave unchanged” and explicit clearing during updates.

UI response fixtures must satisfy the generated DTO for the exact endpoint being consumed, rather than a similarly named record from another module.

**Why:** A dropdown regression passed tests because both the implementation and its hand-written mock used a role field from a different API shape. The real school employee response had a different field, so all returned teachers were filtered out.

**How to apply:** Use generated response types with `satisfies` for fixtures and typed filtering callbacks. Confirm the route's SQL aliases and response schema when tracing a missing option list; matching a mock does not establish matching the real API.

Test valid entity IDs in an invalid relationship, not only missing or foreign-school IDs. A same-school active employee is not necessarily authorized for a selected teaching context.

**Why:** Genuine timetable diagnosis found all selected entities belonged to the school, but the offered employee taught a different subject. Entity-only dropdown filtering produced requests that correctly failed the backend's combination validation.

**How to apply:** Derive instructional choices from the complete existing assignment predicate and retain server-side revalidation. Include both class-subject ownership and teacher-class authorization, wildcard scopes and session-overlap dates; do not narrow legitimate class-teacher authorization to subject-teacher records only.

Do not claim the School Admin timetable workflow is completely fixed without a genuine signed-in Subject → eligible Teacher → Save → refresh browser pass. Preserve existing timetable entries and use existing academic assignments; report browser failures separately from passing automated and read-only database checks.

**Why:** The user reported that earlier dropdown fixes were claimed complete while the actual School Admin journey still failed. A different QA school had mirrored enrollment and staffing relationships, masking the reported school's legitimate staffing-only subject assignments.

**How to apply:** Reproduce the reported school's actual Session/Term/Class/Section first and capture browser endpoint parameters, response shapes and counts before editing. A successful journey in another tenant does not verify the reported problem. Treat the full signed-in timetable journey as the acceptance boundary, not an isolated Teacher dropdown or a mocked API pass. Database persistence alone is insufficient if reload loses the selected view and hides the saved entry. Preserve explicit enrollment restrictions when supporting legitimate staffing-only relationships; never populate missing records merely to make a test pass.