---
name: Telegram Production policy
description: Owner-approved Production Telegram scope and separation between diagnostics and delivery authorization.
---

The Owner has explicitly approved Production-capable Telegram notifications for
eligible users who opt in. The older blanket Development-only notification rule
must not be reapplied to Telegram. Other notification channels and payment/LIVE
restrictions retain their existing scope.

**Why:** The Owner requested actual published-app Telegram functionality, not
merely a different error message or Production diagnostic button.

**How to apply:** Preserve parent-owned chat verification, explicit consent,
school/child relationships, audience/category preferences, existing policy,
durable deduplication and uncertain-send protection. Do not implicitly subscribe
other roles or expand notifications into unsolicited broadcasts.

Owner diagnostics must remain independent of delivery authorization. Successful
bot identity/webhook inspection never authorizes polling, linking or sending.
Production activation needs separately reviewed runtime prerequisites and
explicit enablement; never change secrets, publish, start workers or send a
controlled verification message merely because implementation is authorized.

**Why:** The Owner expressly required diagnostic success not to unlock sending,
and prohibited real API calls or runtime activation during implementation.

**How to apply:** Report configuration existence separately from credential
validity, storage readiness, provider acceptance and physical receipt. Obtain
explicit approval for live verification and use a controlled consenting recipient.
