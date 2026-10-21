---
name: Vitest JSX environment gates
description: Runtime environment stubs can differ between JSX-embedded conditions and component-local environment reads.
---

For environment-gated JSX tested with runtime environment stubs, read the
environment flag inside the component into a local variable and branch on that
variable. Verify the actual production build separately.

**Why:** In this project's React/Vitest stack, a direct JSX condition using
import.meta.env.DEV remained active after vi.stubEnv changed DEV to false.
A component-local environment read made the same production-presentation
regression test pass. Do not assume a runtime stub controls every transformed
JSX expression.

**How to apply:** When a production/development visibility test disagrees with
its environment stub, check where the flag is evaluated before weakening the
test or changing the intended environment boundary.
