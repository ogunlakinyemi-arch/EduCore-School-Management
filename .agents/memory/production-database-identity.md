---
name: Production database identity
description: Avoid mistaking a PostgreSQL database name or a read replica for the deployed application's exact provider and primary.
---

The PostgreSQL database name `neondb` does not distinguish legacy Neon from Replit-managed Helium. A production read query through the platform reaches a replica, not necessarily the deployed application's writable primary; its response cannot prove the application's production connection target when the app accepts a configurable connection string.

**Why:** Provider and instance identity matter when verifying that a backup protects the database actually used by a published application. A familiar default name is not evidence of either.

**How to apply:** Check the production database's Settings in Replit and independently establish the deployed application's connection target without exposing credentials. If either cannot be verified, explicitly report the uncertainty instead of naming a provider or asserting backup coverage.