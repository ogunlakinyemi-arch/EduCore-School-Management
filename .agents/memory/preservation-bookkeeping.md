---
name: Preservation bookkeeping
description: How to report data preservation when ordinary authentication and existing background jobs refresh timestamps.
---

Report protected business-data preservation separately from byte-identical rows. Never silently ignore meaningful changes or describe all data as unchanged when timestamps or authorized acceptance records were updated.

**Why:** Ordinary authenticated acceptance and an existing subscription-enforcement refresh can touch bookkeeping timestamps even when school identities, staffing, enrollments, family links and academic content are untouched. Treating these as business mutations creates a false alarm; hiding them creates a misleading preservation claim.

**How to apply:** Keep the original pre-test baseline immutable. Investigate changed columns before classifying them. List excluded bookkeeping fields and affected-row counts explicitly, alongside newly appended test, audit and notification records. Do not restore legitimate audit events or scheduler state just to produce an identical snapshot.
