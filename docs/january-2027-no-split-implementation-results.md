# No-split implementation results — 28 October 2026

**Status: implemented and verified in Development; not published, not LIVE.**
Current business authority: `january-2027-no-split-payment-policy.md` and
`../replit.md`. The existing Replit product/hosting is retained.

## Exact changes

| Area | Change |
| --- | --- |
| `artifacts/api-server/src/services/retired-payment-workflows.ts` | Permanently denies legacy release-check/billing-context, evidence preview, receipt approval and split simulation, in addition to the existing hosted/split/onboarding retirement. Uses full parameter-segment matching so `+7`, `7e0`, decimal/hex and encoded IDs cannot bypass the policy through downstream numeric coercion. Restores only authenticated per-transaction historical evidence GET/HEAD access; receipt lists/official historical receipts and existing-reference reconciliation retain their existing controls. |
| `services/flutterwave-live-runtime.ts` | Rejects old LIVE checkout at service entry before release queries, reservations or provider access. |
| `services/flutterwave-live-configuration.ts` | Rejects new legacy school/subaccount release authority before evidence processing or database access. |
| `services/flutterwave-split-checkout.ts` | Rejects new split preparation before database access. Historical validation/read helpers remain intact. |
| `lib/flutterwave-live-transport.ts` | Removes the old ₦5,000/₦1,900 subaccount POST construction. Its legacy checkout method always rejects, even with complete old configuration. Historical server GET verification remains available under its existing gates. Direct ₦3,200 verification additionally rejects non-null subaccount, split, ratio/type/value and transaction-charge metadata, including false/zero/empty markers. |
| `lib/fee-providers/index.ts` | Generic Flutterwave initialization rejects SCV2/SCV3 references and any split-related field, even explicitly undefined. Removes split instructions from outgoing payload construction. Independent ordinary non-split payment behavior is preserved. Marks the old input field historical-only. |
| `tools/flutterwave-sandbox-probe.ts` | Operational split probe is permanently rejected before it can create a provider subaccount or charge. Source/evidence is not deleted. |
| School Admin direct-payment panel | Clearly states parent-to-school fee payment, separate School Admin-to-Owner ₦3,200 per student/term collection, all gross proceeds to Owner merchant, independent eligible ₦150 BRO ledger and no entry/liability without an eligible BRO. Existing server-owned readiness and disabled checkout controls are unchanged. |
| Owner subscription-rule screen | Removes active split-settlement/hosted-checkout capability indicators and replaces them with the direct-only policy. |
| OpenAPI compatibility descriptions | Current root description and split compatibility document explicitly mark retired operations and distinguish historical reads/reconciliation. Generated clients/Zod were regenerated successfully. No request identities, schemas or financial tables were removed. |
| Operational documentation | Marks 20 obsolete split/hosted/setup/release/probe guides archived or historical-only. Preserves their evidence below the notices, historical manifests and original snapshots. Removes the superseded external-hosting next step from the prior unresolved-blockers report. |
| `replit.md` / memory | Replaces stale ₦5,000 split guidance with the definitive current rules. Marks the former hosted/manual distribution decision historical so it cannot be restored as current policy. |

API service/lib/tool paths after the first row are relative to
`artifacts/api-server/src`.

### BRO behavior: retained and specifically verified

The existing independent Owner-governed entitlement service already requires
an exact eligible school/student/term verified direct payment, unique historical
attribution, active BRO, approved effective-dated ₦150 policy, retained source
events and intact direct/BRO integrity guards. That source policy was not
weakened or rewritten.

Additional tests prove missing, inactive, unbound and ambiguous eligibility
results produce **no entitlement, no liability, no zero-value row and no new
financial audit**. Eligible processing still records exactly ₦150 once and
returns the same frozen earning on replay. This is not automatic payment,
provider allocation or transfer. Explicit Owner-governed accrual remains;
the implementation does not claim an automatic webhook-to-BRO booking feature.

## Focused test outcomes

**314 distinct backend tests passed across 13 targeted files**:

| File under `artifacts/api-server/src` | Passed |
| --- | ---: |
| `lib/fee-providers/index.test.ts` | 45 |
| `lib/fee-providers/no-split.test.ts` | 12 |
| `lib/flutterwave-live-runtime.test.ts` | 40 |
| `services/direct-student-live-payments.test.ts` | 7 |
| `services/retired-split-issuance.test.ts` | 3 |
| `services/bro-commission-policy.test.ts` | 27 |
| `services/retired-payment-workflows.test.ts` | 45 |
| `routes/direct-student-live-public.test.ts` | 18 |
| `services/flutterwave-split-checkout.test.ts` | 9 |
| `lib/fee-providers/scv2-split.test.ts` | 13 |
| `routes/local-split-simulation.test.ts` | 40 |
| `services/nfc-guest-checkout.test.ts` | 23 |
| `services/flutterwave-splits.test.ts` | 32 |

The first eight files passed together (197). The five additional directly
affected historical suites were checked separately; obsolete tests expecting
fresh split issuance were updated to require retirement, not to bypass it.
The one corrected split-service file then passed all 32 tests. Historical
calculation, encrypted evidence, refund/paid replay denial and settlement
validation assertions remain; retirement was not mocked away.

**9 distinct frontend checks passed**:

- `src/pages/subscription-payment-rules.test.tsx`: **5/5**.
- `src/components/direct-student-live-panel.test.tsx`: **4/4** after updating its
  old-copy assertion to explicitly check the definitive rules. The unchanged
  rule-screen suite was not repeated after that test-only correction.

These are focused mock/loopback/component checks, not genuine merchant,
Production database or authenticated Owner-browser evidence. No broad backend,
January rollover or disposable financial PostgreSQL rehearsal was repeated.

Other checks:

- OpenAPI generation and its chained shared-library TypeScript build: **passed**.
- API TypeScript: **passed**, including the final focused test changes.
- Frontend TypeScript: **passed**.
- Development API build/start and frontend managed restart: **passed**.
  Subscription/notification workers remain paused for controlled verification.
- Through the actual Development proxy, legacy release-check GET, encoded
  receipt-approval POST and split-simulation POST each returned **HTTP 410**
  with `PAYMENT_WORKFLOW_ARCHIVED`; no payment was initiated.
- Public app screenshot renders the sign-in page normally. No login attempt,
  account creation or authenticated payment-flow acceptance was performed.
- Optional Git whitespace/status checks were blocked by the workspace's
  `.git/index.lock` safety guard, including a no-optional-locks attempt. No
  elevated override, lock deletion or Git modification was attempted. Passing
  compiler/test/runtime checks are separate from this unavailable Git check.

## Remaining LIVE blockers — not split prerequisites

Removing split functionality does **not** authorize removing the direct-payment
and BRO integrity gates. The following remain unresolved/unproven:

1. **Supported Replit Production enforcement delivery and acceptance:** exact
   required four functions/nine triggers, serving-primary/resource binding,
   runtime permissions and accepted recovery evidence. Existing documented
   platform limitations were not reopened or bypassed. No current supported
   procedural delivery mechanism is established by this work.
2. **Genuine merchant and webhook verification:** actual LIVE merchant,
   dedicated configuration and independent non-split evidence; exact public
   callback/webhook dashboard binding; authenticated external delivery and
   replay. Previously reported Owner approvals are acknowledged, not declared
   missing. Local tests/key presence cannot certify them.
3. **Exact January release governance:** each school's actual January
   second-term start, eligible ₦3,200 rule/version, relevant approved ₦150 BRO
   policy, fresh reconciliation, unexpired scope-bound Owner review and explicit
   operational authorization. No school date, rule or approval was invented,
   created, activated or converted.
4. **Operational acceptance:** pending/missed notification recovery, full webhook
   timing under database contention and genuine authorized Owner acceptance.
   Existing queued follow-ups were not treated as assigned or completed.

Keep hosting on Replit and fail closed until these independent prerequisites
are proven. A later app Publish alone cannot certify/install missing procedural
guards. Do not treat old split flags/approvals as an alternative.

## Safety boundary

No new host, service or package was provisioned. No secrets or operational flags
were changed. No Production SQL/query/migration, real financial-record mutation,
real Flutterwave call/payment/transfer, notification send, schema/history
deletion, publishing, Production redeployment or LIVE activation occurred.
Development-only restarts are not Production redeployments.
