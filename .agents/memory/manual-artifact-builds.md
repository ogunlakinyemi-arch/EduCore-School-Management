---
name: Manual artifact builds
description: Local shell builds and managed artifact workflows do not necessarily inherit the same service environment.
---

When manually building an artifact from a shell, do not assume the environment matches its managed workflow. Use the artifact's validated service environment for required non-secret build variables.

**Why:** A production-mode build failed twice despite the running preview and passing typechecks because service variables were available to the workflow but not the shell command.

**How to apply:** Before diagnosing a manual build failure as a code issue, check the artifact manifest's complete service environment and pass every required non-secret value to the shell build together rather than chasing missing-variable errors one by one. Never print or manually retrieve secrets.