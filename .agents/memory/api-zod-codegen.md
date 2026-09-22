---
name: API Zod codegen collisions
description: Orval can emit duplicate parameter names when path and query parameters share operation-derived types.
---

When Orval generates a duplicate parameter type in both generated/api and generated/types, exporting both files from the api-zod barrel breaks the workspace typecheck. Keep the barrel focused on the generated Zod schemas unless the generated types are known not to collide.

**Why:** The generated client can be valid while the downstream composite typecheck fails on duplicate exports, which blocks all consumers.

**How to apply:** After changing OpenAPI paths with path and query parameters, run codegen and the workspace typecheck before adding server imports; inspect generated export names instead of guessing them.