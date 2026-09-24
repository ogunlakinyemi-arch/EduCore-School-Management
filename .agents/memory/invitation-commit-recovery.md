---
name: External invitations and uncertain commits
description: How to handle invitation delivery coupled to a database transaction when the commit response is ambiguous.
---

If an identity provider sends an invitation before the matching local onboarding transaction commits, never assume a failed COMMIT response means the transaction was rolled back. Check persistence from an independent connection. Revoke the invitation only after confirming the transaction did not commit and rollback succeeded; when the outcome is unknown, keep it and report an uncertain state for manual reconciliation.

**Why:** A database can commit successfully while the client loses the response. Revoking the external invitation in that case strands a persisted school or partner without a usable administrator.

**How to apply:** Use this rule wherever a Clerk invitation, email, or other external side effect is paired with local onboarding data. Distinguish known aborts, known commits, and unknown outcomes explicitly.