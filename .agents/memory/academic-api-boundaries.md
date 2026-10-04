---
name: Academic API boundaries
description: Calendar SDK coercion and optional-comment wire formats can hide browser-only failures.
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