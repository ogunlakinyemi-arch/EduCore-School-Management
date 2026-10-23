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

Local Email/Push setup readiness must remain separate from delivery permission.

**Why:** The Owner explicitly requested usable preference/device setup without
setting the launch cutoff or releasing any TEST backlog. Treating the launch hold
as missing configuration wrongly disables safe setup and mislabels Production
holds as Development restrictions.

**How to apply:** Keep real sending/claims and default-channel validation behind
the launch guard. Permit explicit preference/subscription preparation only when
local configuration is valid, report the hold truthfully, and never equate setup,
credential presence, provider acceptance or browser registration with receipt.

Owner category rows must distinguish a valid configuration held by the launch
safeguard from missing/invalid configuration. Do not label both states generically
as “Permitted, not yet deliverable.”

**Why:** The Owner repeatedly requested removal of this misleading status without
authorizing cutoff changes or real sending; reporting readiness is not permission
to bypass the launch guard.

**How to apply:** Render configuration and delivery holds separately in the rows,
not only in a summary. Keep browser subscription diagnostics scoped to the current
device; an Owner's absent subscription must not disable other recipients.

Production email screenshot evidence conflicts with automated presence metadata.

**Why:** A visible configuration entry and a false presence result do not
establish that a setting is missing or loaded by the serving process.

**How to apply:** Report unresolved configuration, confirm full saved key names
and intended app, and never add duplicate settings or silently choose Resend from
key presence. No source-only check proves provider/domain authorization.
