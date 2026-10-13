---
name: Vite private-file hardening
description: Non-obvious cache and SPA behavior when restricting Development file access.
---
Canonical-path checks must retain narrowly approved optimizer caches and the exact HTML entry file, without granting the entire artifact/workspace root.

**Why:** Vite can successfully serve its entry HTML, source entry and client while optimized dependency requests are blocked by an additional canonical-path guard. The visible app then remains on a connection screen. Also, a nonexistent private filename can fall through to successful SPA HTML rather than trigger ordinary filesystem denial.

**How to apply:** Verify denied private paths and rendered client initialization together. Explicitly reject private metadata URLs before SPA fallback, check symlink escapes by canonical path, and allow only the dependency cache needed by each frontend. HEAD checks alone do not prove dependencies render.
