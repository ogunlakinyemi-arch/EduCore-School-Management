---
name: Vitest file completeness
description: Avoiding incomplete test claims when explicit command-line file lists encounter configured include filters.
---

Compare requested test files with the actual executed-file summary before claiming complete coverage. Explicit Vitest file arguments still respect configuration include filters.

**Why:** An invitation audit requested both TypeScript and TSX frontend tests, but the frontend's TSX-only configuration silently omitted a named TypeScript test while the command succeeded. The omitted test passed when run under a compatible configuration.

**How to apply:** Check executed file counts and names, not only exit status. Run excluded, relevant files separately with an appropriate configuration instead of reporting them as covered or unnecessarily broadening the application's test configuration.