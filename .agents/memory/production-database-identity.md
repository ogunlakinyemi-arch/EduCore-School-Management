---
name: Production database identity
description: Avoid mistaking a PostgreSQL database name or a read replica for the deployed application's exact provider and primary.
---

The PostgreSQL database name `neondb` does not distinguish legacy Neon from Replit-managed Helium. A production read query through the platform reaches a replica, not necessarily the deployed application's writable primary; its response cannot prove the application's production connection target when the app accepts a configurable connection string.

**Why:** Provider and instance identity matter when verifying that a backup protects the database actually used by a published application. A familiar default name is not evidence of either.

**How to apply:** Check the production database's Settings in Replit and independently establish the deployed application's connection target without exposing credentials. If either cannot be verified, explicitly report the uncertainty instead of naming a provider or asserting backup coverage.

A verified published URL and successful build do not establish the runtime
database binding. The deployment metadata response observed on 1 October 2026
did not include a database-resource ID or recovery-point inventory.

**Why:** Deployment availability, database identity and backup recoverability
are separate evidence requirements. A rolled-back Development schema rehearsal
also does not test restoration of Production data.

**How to apply:** Inspect the current tool response before assuming it exposes
these facts. If binding/recovery metadata is absent, mark it unverified and
require operator evidence from the intended database resource; do not substitute
documented retention defaults or an enabled backup setting for observed points.