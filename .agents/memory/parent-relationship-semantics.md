---
name: Parent relationship semantics
description: Preserve child-specific relationships while saving the parent form's default selection.
---

Treat a parent profile's relationship selection as a default for new child links, not permission to change existing child relationships. An explicit relationship selected for a child takes precedence over that default.

**Why:** The product requires both exact saved choices such as Mother or Father and multiple linked children. Existing relationships are authoritative per child; a global profile edit must not silently replace them.

**How to apply:** Persist profile preferences independently, initialize new-link forms from the saved default, and retain explicit per-child selection. Never guess or backfill a previously discarded selection.