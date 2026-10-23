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

Configuration readiness checks must not require a real school or recipient.
A paused Development transport remains validly configured; its intentional
send-time suppression is not evidence of missing provider configuration.

**Why:** The Owner has no real school tenant yet and explicitly requested
launch preparation without fake tenants, real parent emails or relaxed locks.

**How to apply:** Use local configuration validation and read-only provider
health checks; report Development safety holds separately from launch holds.
Connected-account domain verification is not proof that the app credential
can send, and neither check proves recipient receipt.

Owner category rows must distinguish a valid configuration held by the launch
safeguard from missing/invalid configuration. Do not label both states generically
as “Permitted, not yet deliverable.”

**Why:** The Owner repeatedly requested removal of this misleading status without
authorizing cutoff changes or real sending; reporting readiness is not permission
to bypass the launch guard.

**How to apply:** Render configuration and delivery holds separately in the rows,
not only in a summary. Keep browser subscription diagnostics scoped to the current
device; an Owner's absent subscription must not disable other recipients.

Screenshot evidence must be matched to exact key names and environment scope.

**Why:** A visible credential does not establish provider selection or sender
configuration. Development-only settings with the same names do not establish
Production presence, and saved presence does not prove serving-process loading.

**How to apply:** Use Production-scoped presence metadata, including shared
settings, and compare the exact lookup names and configuration scopes. Report
unresolved conflicts rather than adding duplicates or silently choosing Resend
from credential presence. No source-only check proves provider/domain authorization.
An email received from the company domain establishes that message's receipt,
not that EduCore sent it or that the app's configured API key uses the same
provider account. Keep that distinction when explaining sender readiness.

The Owner's company contact mailbox is already correctly published on the public
website. Configuring EduCore email routing does not authorize changing that site.

**Why:** The Owner explicitly confirmed the company contact and requested its use
where supported, without assuming a Google-owned domain is a Resend sending identity.

**How to apply:** Preserve the company contact as Reply-To for Resend emails and
retain a separately configured, provider-verified From domain. Direct Gmail sending
needs separately authorized Gmail OAuth and a sending adapter; do not silently
switch providers, add Production secrets, or enable sending.

EduCore sender work is limited to School Management, not the separate marketing
website. Clerk-managed authentication emails are a separate configuration boundary.

**Why:** The Owner explicitly excluded marketing settings and authentication
behavior changes while requesting consistent application-generated email routing.

**How to apply:** Configure the existing application email adapter without
replacing Clerk verification, password-reset or invitation flows. Report Clerk
sender-access restrictions separately; do not introduce custom auth delivery or
change DNS merely to make those emails use the application sender.
