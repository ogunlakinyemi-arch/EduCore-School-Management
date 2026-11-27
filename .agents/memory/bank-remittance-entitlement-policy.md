---
name: Bank remittance and refund entitlement policy
description: Owner-authorized aggregate bank credit and partial-refund access rules.
---

New company-bank remittance requests may establish student subscription entitlement
after independent Owner verification of the exact aggregate company-bank credit
and per-student allocation. Each eligible student is NGN 3,200; valid attributed
BRO earnings remain a separately funded NGN 150 liability.

**Why:** The user explicitly authorized completing this workflow on 2026-11-27,
superseding the earlier rule that even verified company receipts could never
establish entitlement. This does not retrospectively convert retained receipts,
approve a database migration or authorize LIVE operation.

**How to apply:** Require fresh audited verification and immutable allocations.
Requests, uploads and beneficiary-name verification are never payment proof.
Keep existing single-student receipt evidence intact unless separately reconciled.

Partial refunds/reversals retain access while verified net payment is positive;
full refund/reversal removes paid entitlement. BRO adverse holds remain separate.

**Why:** The user explicitly selected “Retain access until fully refunded.”

**How to apply:** Share the net-payment policy across all access, subscription
enforcement and NFC readers. Never restore BRO payout authority merely because
student access remains permitted.

Releasing an unpaid reservation must preserve a native unique active-reservation
key while retaining immutable financial allocation/release history.

**Why:** An advisory lock followed by a SELECT does not replace UNIQUE under
repeatable-read snapshots. Cancellation must not create a duplicate-billing path.

**How to apply:** Maintain the native uniqueness index transactionally through
checked allocation/release operations; never substitute only application checks.
