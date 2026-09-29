---
name: Vite cartographer JSX generics
description: Development-only transform incompatibility with generic JSX component syntax.
---

Avoid type arguments directly on JSX component tags in the Yemait web app; use inferred props or a typed alias outside JSX instead.

**Why:** The development cartographer plugin injected metadata into a generic JSX opening tag incorrectly, producing a Vite parse error even though TypeScript typecheck and the production build passed.

**How to apply:** When a new component typechecks but fails in the development preview with a malformed tag, inspect the Vite transform logs and remove JSX tag type arguments while preserving prop types. Verify the transformed module through the proxied preview.