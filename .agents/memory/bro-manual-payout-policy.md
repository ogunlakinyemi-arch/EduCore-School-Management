---
name: BRO manual payout and beneficiary policy
description: Owner records external transfers only; full payable balance and verified registered-person bank evidence.
---

## Current ₦150 withdrawal-request workflow

Verified eligible student/term payments automatically earn individual ₦150
entitlements, independently funded rather than deducted from the ₦3,200 fee.
Ten qualifying students therefore mean ₦1,500. BRO and Platform Owner dashboards
must show consistent student counts and earned/pending/approved/available/paid
totals, with each BRO limited to their own eligible earnings.

BROs may request withdrawal against their own eligible accrued entitlements.
Platform Owner approves or rejects each student entitlement inside that request.
The decision is the entitlement's approval: do not add a redundant second
approval stage before the payout workflow. Requested, approved and available
are distinct from paid funds. Distinguish Owner-recorded, statement-reviewed
external transfers from independently provider-reconciled transfers; never label
the former automatic bank verification.

**Why:** The user explicitly chose withdrawal requests with per-student Owner
decisions and consistent dashboard totals while retaining the ₦150 rate.

**How to apply:** Preserve eligibility/maturity, individual approval, frozen
verified-bank evidence, adverse-event holds, concurrency and recovery controls.
Use supported payout evidence, never an approval checkbox as proof of credit.
This product decision does not authorize real transfers or runtime activation.
Keep the historical manual workflow below distinct from new withdrawal requests.

A single completed external transfer may cover several already-reserved,
approved current entitlements only for the same BRO and frozen verified bank.
Its exact amount must equal those lines; preserve one reusable-evidence boundary
across both current and retained payout history, not separate payment ledgers.

**Why:** External bank transfers are often aggregated. Supporting that workflow
must not turn an arbitrary amount, approval, typed reference or repeated
submission into additional commission or a claim of automatic verification.

**How to apply:** Keep actual transfer date, Owner recording identity/time,
statement reference and immutable audit history. Require explicit external
completion and statement-review confirmations; recording never sends money.

## Retained manual payout and beneficiary policy

BRO commission remains internal until the Owner records a separately completed
bank transfer. Select the BRO, use the complete actual available payable balance,
and preserve existing pending-approval, held, deferred-export and historical
earnings boundaries. Accrued/outstanding does not mean available to pay.

**Why:** On 2026-10-28 the user explicitly replaced typed IDs/arbitrary amounts
with BRO selection and required correct Owner ledger figures. The later
visibility correction permits each BRO to read their own verified eligible
commission only, never school collections, platform revenue or other BROs.
This does not restore payout authority or overall policy/report visibility.
They authorized manual Owner transfer recording, not automatic money movement.

**How to apply:** Never invoke a transfer/payout API or manufacture payable entries
from the independent NGN 150 pending-approval entitlement history. Freeze verified
bank instructions per payout so later bank edits cannot change its destination.
Record explicit external-completion confirmation, Owner identity/time and exact
ledger reconciliation, retaining retry, concurrency and duplicate-reference guards.
Keep the BRO's own earning view separate from Owner-controlled payouts and
overall financial reports; earning is not payout approval or money movement.

BRO beneficiary verification uses the registered person's full name, not the
company-beneficiary rule. Automatic LIVE lookup followed by proof-backed saving
is required; legacy active details, refresh and saving alone are not proof.

**Why:** The user requires the returned bank name to match the BRO's registered
identity and forbids sandbox/Development verification of real accounts.

**How to apply:** Keep a documented conservative ordered-name comparison without
fuzzy matching, initial expansion or missing/extra names. Recheck identity, saved
bank revision, exact input and expiry on save; mask routine reads and audit
Owner-only full-number reveals. Failed proposed edits preserve saved history.

Only the actual BRO profile owner may read, resolve or replace their payout
account through self-service. Delegated BRO administrators, finance staff and
other delegates must not gain this access. Owner routine reads remain masked;
full-number reveals are limited to the audited, frozen payout snapshot.

**Why:** The user explicitly required actual profile-owner scope with no delegated
or cross-BRO access, and reserved full-number disclosure for frozen payout evidence.

**How to apply:** Allow only the exact account GET, lookup POST and save PATCH
through the financial privacy boundary; retain all legacy commission/payout
denials. Recheck ownership during locked saves, and never redirect an existing
payout snapshot when the BRO replaces the current account.
