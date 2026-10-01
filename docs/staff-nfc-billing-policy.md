# Teacher/Staff NFC E-ID billing policy

This policy supplements `attached_assets/Pasted-Yemait-EduCore-Consolidated-Testing-Feedback-Correction_1790850219635.txt`. It records the user's confirmed billing decisions, not provider delivery or settlement evidence.

## Confirmed amounts and fee policy

- Student subscription: NGN 5,000 per student per academic term. School receives NGN 2,000. For an eligible Partner, NGN 100 is deducted from the platform's NGN 3,000 gross share, leaving NGN 2,900 before provider fees.
- Staff subscription: initial price NGN 2,000 per Teacher/Staff employee per academic term.
- With an eligible Partner: school NGN 800, platform NGN 1,100, Partner NGN 100.
- Without an eligible Partner: school NGN 800, platform NGN 1,200, Partner NGN 0. The user explicitly confirmed that the unused NGN 100 belongs to the platform.
- The platform bears provider fees. Preserve contractual allocations; account for actual provider fees as a separate platform expense and show gross, provider fee, settlement, payment and reconciliation states separately.
- No invented, unrelated, user-selected or inferred Partner attribution. Use the existing server-side school attribution and eligibility rules.

## Billing rules and terms

Platform Owner Finance must have Billing Rules. Rules are configurable, effective-dated and versioned. The initial active NGN rule is Teacher/Staff NFC E-ID, per academic term, with the amounts above.

Each subscription snapshots the applicable rule/version at creation. Future changes apply only to new subscriptions after the effective date; existing subscriptions retain their original amounts and allocations.

Link employee, school, academic session, term, subscription, payment and allocation. Permit only one subscription for an employee and term. Activating a new academic term generates eligible staff subscriptions idempotently using the applicable rule. A paid first term does not cover a later term.

## Payments, allocations, receipts and refunds

Staff can pay through the existing Flutterwave architecture. Only independently verified server-side success activates the term subscription and updates NFC eligibility. Never activate from a frontend callback alone.

Track unpaid, pending, paid, failed, cancelled, refunded and partially refunded states where supported.

Successful payments create immutable SCHOOL, PLATFORM and eligible PARTNER allocation records referencing payment, subscription, employee, school, session, term, recipient, amount, currency, attribution, rule version and timestamp. Never reconstruct historical allocations from current settings.

Provider transaction/reference, subscription, allocations, commission and receipt uniqueness must prevent repeats across webhooks, callbacks, refreshes, checkout retries, manual verification and reconciliation.

Refunds retain the original payment and allocations. Verified refunds create immutable, idempotent reversal/reconciliation records for school, platform and Partner allocations, including partial amounts where supported. Never label an unverified refund as successful.

## Role-specific interfaces

- Teacher/Staff: own session, current term, price, payment status, card status, due date, next term, history, receipt and Pay/Subscribe. No access to another employee's subscription or salary.
- School Admin Finance: own school's staff identities, terms, amounts, payment dates/status, school allocations, outstanding subscriptions, history, receipts and appropriate reconciliation. Do not expose confidential platform financial details.
- Owner Finance: global gross revenue, school/platform/Partner allocations, paid/pending/failed/refunded subscriptions, settlement and reconciliation; filters for school, session, term, date, status, Partner and employee.
- Partner: eligible attributed-school staff subscription activity and counts, own pending/paid commission, history, school/session/term. No payroll, bank information or unrelated school financial details.

## NFC eligibility and historical preservation

Integrate term billing into employee NFC lifecycle. Under the configured paid-subscription policy, paid/current subscriptions permit service; unpaid/expired subscriptions restrict service. Do not delete or collapse card identity/history, attendance history, subscription history or payment history when terms expire or refunds occur.

Reuse existing Finance, academic periods, employees, NFC, Flutterwave, attribution, commissions, audit, authentication and RBAC. Keep school/company payroll independent, keep platform ownership separate from ordinary school operational writes, and protect mixed-role Owner sessions.

## Verification and database restrictions

Implement all 28 billing/payment/term/Partner/access/refund test cases in the user's response and run full regression suites. In particular test both Partner branches sum to NGN 2,000, historical version retention, term isolation, duplicate payment/receipt/allocation/commission/reversal prevention, verified-only activation, role/tenant isolation and fee expense treatment.

Inspect existing schema before adding models. Use incremental Development migrations only, validate clean replay and preservation, never rerun the previous structural package, never alter Production or its migration ledgers, and never publish automatically. Do not run destructive SQL.

Use safe sandbox/mock provider infrastructure for Development validation. Clearly distinguish mock verification from real provider/payment/webhook/transfer/settlement evidence. Never claim live settlement without proof.