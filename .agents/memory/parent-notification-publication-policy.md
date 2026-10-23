---
name: Parent notification publication semantics
description: Publication atomicity, genuine republications, and repeated manual attendance submissions.
---

Result-publication success must include durable parent-notification intent.
Actual sending happens only after commit; drafts and approval alone are silent.
If intent cannot be persisted, roll back publication rather than report success
and silently lose the notice.

**Why:** The Owner requested transactional parent emails from actual school
workflows, not merely account emails. Post-commit best-effort queuing leaves a
published report with no recoverable notice when the queue fails.

**How to apply:** Keep publication and notice persistence atomic. Do not apply
this failure policy blindly to attendance: preserving accepted attendance evidence
remains more important than notification infrastructure availability.

A genuinely corrected, reviewed and republished report is a new publication,
whereas retrying the same publication is not.

**Why:** Duplicate prevention must not suppress a legitimate corrected-report
notice indefinitely just because the report retains its identity.

**How to apply:** Distinguish publication revisions without notifying on draft
edits or weakening the existing correction, approval and school authorization rules.

An identical repeated manual attendance submission is a retry, not fresh
attendance evidence. Different genuine events and authorized corrections remain
distinct.

**Why:** Repeated clicks or transport retries must not produce extra attendance
records and therefore extra parent notifications.

**How to apply:** Reuse the original event for a repeated action; preserve the
existing correction flow rather than overwriting attendance facts during replay.
