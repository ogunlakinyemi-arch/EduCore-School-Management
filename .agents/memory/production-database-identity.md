---
name: Production database identity
description: Avoid mistaking a PostgreSQL database name or a read replica for the deployed application's exact provider and primary.
---

## Reuse existing confirmations

On 2026-11-25 the Owner explicitly confirmed that they matched the database
serving educore.yetenia.com to the resource in the Production backup screen.
Accept this as Owner-confirmed resource matching and do not ask them to repeat it.

**Why:** Repeated requests for the same confirmation confused unavailable
operator identifiers with a lack of Owner confirmation.

**How to apply:** Distinguish that accepted confirmation from independently
retrieved resource/recovery metadata. Do not fabricate identifiers or select an
entry labelled Scheduled as a completed backup. PITR may use a verified
pre-change timestamp instead of a completed daily-backup identifier.

Do not make a daily-backup ID an unconditional recovery requirement when PITR
is the accepted recovery mechanism.

**Why:** Official recovery guidance supports timestamp-based PITR independently
of daily snapshots; repeated requests for a snapshot ID obscured that distinction.

**How to apply:** Accept the Owner's PITR/resource confirmations as such, then
separate supported configuration from live timestamp availability and verified
primary execution access. Never invent a restorable range or assume an Agent
replica interface provides the Production operator console.

The owner stated on 2026-10-26 that Production database binding/recovery and Flutterwave merchant prerequisites were completed earlier and supported by confirmation emails. Do not describe those confirmations as absent or ask the owner to obtain them again.

**Why:** The owner corrected repeated activation reports that treated inaccessible confirmation evidence as missing approvals.

**How to apply:** Locate existing project references and authorized correspondence first. If the original replies cannot be retrieved, request only their redacted approval text and referenced resource/recovery evidence. Distinguish owner-reported completion, inspected confirmation evidence and available execution permissions; none substitutes for the others.

The PostgreSQL database name `neondb` does not distinguish legacy Neon from Replit-managed Helium. A production read query through the platform reaches a replica, not necessarily the deployed application's writable primary; its response cannot prove the application's production connection target when the app accepts a configurable connection string.

**Why:** Provider and instance identity matter when verifying that a backup protects the database actually used by a published application. A familiar default name is not evidence of either.

**How to apply:** Check the production database's Settings in Replit and independently establish the deployed application's connection target without exposing credentials. If either cannot be verified, explicitly report the uncertainty instead of naming a provider or asserting backup coverage.

A verified published URL and successful build do not establish the runtime
database binding. The deployment metadata response observed on 1 October 2026
did not include a database-resource ID or recovery-point inventory.

On 2026-10-24, the owner explicitly confirmed that the published app uses the
`neondb` resource shown in Replit's Production Database settings and reported
screenshots of enabled scheduled backups, dated restore points and seven-day
PITR. This is owner-provided UI evidence, not an API-verified runtime binding
or a resource-bound isolated restore drill. It does not establish the current
availability of any point on a later date.

On 2026-11-09, new screenshots were inspected showing the selected Production
Database's Settings with seven-day PITR and scheduled backup retention enabled
and an observed recent backup, plus its Overview. Accept these as current
owner-provided recovery UI evidence for that date. They do not expose the serving
deployment's binding, establish a writable primary session or test restoration.
Do not ask for the same backup-enabled screenshots again or call backups absent.

**Why:** Deployment availability, database identity and backup recoverability
are separate evidence requirements. A rolled-back Development schema rehearsal
also does not test restoration of Production data.

**How to apply:** Inspect the current tool response before assuming it exposes
these facts. If binding/recovery metadata is absent, mark it unverified and
require operator evidence from the intended database resource; do not substitute
documented retention defaults or an enabled backup setting for observed points.

Replica sequence reads can succeed. A successful read, or a zero-violation
aggregate, must not be treated as authoritative evidence of the current primary
sequence position.

**Why:** The Production-routed read-only replica accepted sequence-relation
preflight SELECTs, but their release gate required verified primary evidence.
Replica observations and cached sequence positions do not establish that.

**How to apply:** Preserve the read-only result as an observation; require
separate primary identity and cache/recovery review before certifying sequence
safety for migration authorization. Never call nextval/setval to test access.

The user does not authorize repeating hidden runtime-binding investigation during focused reconciliation-readiness reviews.

**Why:** They repeatedly constrained these reviews to existing binding evidence and targeted read-only checks, with binding uncertainty reported separately as an operator deployment prerequisite.

**How to apply:** Do not repeat broad runtime/deployment discovery to resolve known uncertainty. Keep replica sequence observations distinct from primary certification; a focused readiness conclusion is neither binding proof nor authorization to execute migrations.