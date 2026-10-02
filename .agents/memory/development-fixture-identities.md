---
name: Development fixture identities
description: Provider normalization and evidence rules for temporary signed-in QA accounts
---

Retire Development fixtures that have immutable operational history rather than deleting that history or temporarily disabling its protections. Retain the necessary reference records and revoke device credentials as well as user access.

**Why:** The user explicitly requires security and promotion history to remain immutable during fixture cleanup. Removing identity-provider accounts alone does not stop independently authenticated NFC devices.

**How to apply:** Cleanup must distinguish mutable derived state from history; preserve original-row multisets while allowing legitimate appended QA/audit records.

Use an IANA-reserved conventional email domain for Clerk Development fixtures and compare returned addresses case-insensitively. Record an accepted provider identity before performing further response validation.

**Why:** Clerk rejected `.invalid` email addresses and canonicalized a mixed-case address. A post-create validation failure left an accepted identity untracked until reconciliation by its exact synthetic address and ownership metadata.

**How to apply:** Before retrying failed fixture provisioning, reconcile all exact fixture identifiers, including entries without a captured provider ID. Never remove an unrelated account or revoke an identity after an uncertain database commit.

Preservation evidence must distinguish unchanged original audit rows from newly appended audit entries.

**Why:** A legitimate anonymous invalid-tracking test appended a security audit entry. Treating any audit-table count growth as historical corruption would encourage deleting valid security evidence.

**How to apply:** Keep the original baseline, prove original audit rows still match it, retain new legitimate audit entries, and capture a separately explained current baseline for fixture guards.

When additive migrations introduce immutable security/history tables, explicitly review the fixture cleanup guard before provisioning signed-in QA accounts. Never bypass an unknown retention trigger to make a test run.

**Why:** A guard designed for the earlier schema rejected the new security-history triggers. Stopping provisioning avoids creating records whose safe cleanup has not been proven.

**How to apply:** Recognize only reviewed trigger definitions, retain scoped deletion and original-data checks, and compare original columns when additive defaults change whole-row JSON fingerprints.