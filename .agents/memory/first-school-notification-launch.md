---
name: First real-school notification boundary
description: TEST-only existing data and the external-notification launch safety rule.
---

All existing schools, users and notification records were explicitly declared
TEST data by the Owner on 2026-10-23; no live schools were onboarded. Preserve
those records; that declaration does not authorize delivery or deletion.

**Why:** Historical queued/failed work and edits to TEST contact details must not
turn into real-school notifications when credentials or a release become usable.

**How to apply:** Keep a fail-closed external launch boundary chosen after TEST
onboarding and before real onboarding. Existing TEST school/user identities must
not be converted to live identities by backdating the cutoff or rewriting creation
timestamps. Any explicit promotion mechanism requires separate review. In-App
history remains available under existing authorization. After the cutoff, dates
alone cannot classify new QA data; keep QA in Development or hold external sends.
The guard is source-only until an approved release; never restart/publish or
configure it merely to validate readiness.

Production email screenshot evidence conflicts with automated presence metadata.

**Why:** A visible configuration entry and a false presence result do not
establish that a setting is missing or loaded by the serving process.

**How to apply:** Report unresolved configuration, confirm full saved key names
and intended app, and never add duplicate settings or silently choose Resend from
key presence. No source-only check proves provider/domain authorization.
