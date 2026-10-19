---
name: Application decision confirmation
description: Recovery and verification boundaries after uncertain Owner application decision requests.
---

A transport error is not proof that an Owner application decision rolled back.
Reconcile with a fresh server read before allowing another decision. Never
automatically repeat approval/rejection or resend a notification after an
ambiguous response. Distinguish activation status from notification acceptance
and physical delivery.

**Why:** A reported Failed to fetch was followed by an independently verified
committed approval and active matching school membership. The error's original
network trigger could not be reproduced; it would be unsafe to infer failed
activation or send another approval email from that screenshot alone.

**How to apply:** Use authoritative decision responses or a fresh authorized
status read, preserve the original error when explaining recovery, and require
manual refresh/review if status is still Pending or unavailable. Do not weaken
authorization/CORS or claim the original transport cause is fixed without evidence.

Notification recovery must be a separate operation from approval. Preserve the
committed school/Partner access, retry only outcomes known not to have been
accepted, and require provider evidence for uncertain sends. Provider acceptance
is not delivery; a delivery claim needs a verified matching provider receipt.

**Why:** The user explicitly requested notification-only recovery after an
approved applicant received no email while Development sending was intentionally
paused. This does not authorize lifting a pause or replaying approval.

**How to apply:** Keep send-time locks on manual actions as well as workers,
require separate authorization for real sends/settings changes, and refuse blind
retries of accepted, in-flight, uncertain or insufficiently documented outcomes.
