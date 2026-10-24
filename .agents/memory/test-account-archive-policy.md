---
name: Test-account archive access policy
description: Existing-account revocation must preserve Owner, unrelated access and historical lineage.
---

Explicitly archived test schools and test Partners must lose existing EduCore
account access, including old sessions and invitation/link re-entry, not merely
new registrations. Preserve the Platform Owner and unrelated legitimate tenants.
Keep historical audit, financial, membership, device/card and provenance records;
do not delete Clerk identities or globally disable authentication.

**Why:** The user clarified that all existing test accounts must be unable to
enter EduCore again, while required historical and legitimate data remain intact.

**How to apply:** Use explicit school and Partner allowlists, not referral or
audit authorship as evidence that someone is disposable. Refuse the entire batch
for a non-Owner identity with out-of-scope tenant associations rather than
silently blocking legitimate access. Restoration must be a separate Owner action
and must not activate previously inactive users or reconstruct memberships.
