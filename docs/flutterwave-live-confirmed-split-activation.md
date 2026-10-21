# Confirmed Flutterwave split model — disabled LIVE activation checklist

**Next Development increment:** an Owner-only read-only evidence import preview
and actual ingress factory now reuse the existing authority and durable lifecycle
checks. See [operator steps and unchanged gates](flutterwave-live-evidence-preview-and-ingress.md).
This preview is not the separately authorized authority-approval/import workflow.
The real handler still returns 503 / `processed:false`.

## Written support confirmation and policy

The user supplied written Flutterwave support confirmation specifying
`transaction_charge_type: "flat_subaccount"` and each recipient's fixed
`transaction_charge`, omitting `transaction_split_ratio`, with the dashboard's
**Settings > Business preference > fee bearer set to Merchant**.
The example charges the customer NGN 5,000, pays the school NGN 1,900 and
optionally pays a Partner NGN 100 through a second subaccount.

That reply confirms provider split semantics; it is **not** evidence of this
merchant's actual dashboard setting, ownership of a school subaccount or any
bank settlement. It supersedes the older documentation-contradiction blocker
about the intended fixed-amount model, not the operational acceptance gates.

EduCore's existing business policy deliberately differs from the example's
Partner branch. For new SCV3 student/term subscriptions:

- Customer pays exactly NGN 5,000; independently verified `charged_amount`
  must also equal NGN 5,000.
- Exactly one school checkout recipient receives NGN 1,900:
  `{"id":"<verified LIVE school ID>","transaction_charge_type":"flat_subaccount","transaction_charge":1900}`.
- No `transaction_split_ratio`, Partner subaccount or main-merchant subaccount
  appears in the generated allocation preview.
- The merchant absorbs actual gateway expenses. The dashboard setting is
  necessary; the preview does not pretend a checkout field sets it.
- Merchant cash is NGN 3,100 less evidenced actual fees/taxes.
- An eligible Partner's NGN 100 is accrued internally. Owner economic net
  subtracts that liability; merchant cash does not subtract an immediate payout.
  No eligible Partner means no liability.
- Commissions remain subject to term-end Owner approval/export. Export is not a
  transfer or Paid evidence. Adding a Partner checkout subaccount needs a new,
  explicit user policy decision.
- Historical legacy/SCV2 references and settled records remain unchanged.

## Focused implementation

The shared confirmed-model descriptor and preview live in
`flutterwave-live-split-authority.ts`. The preview is a pure allocation portion,
not a complete payment request, provider call or activation capability.

Intent issuance now requires a strict structured authority document matching
the existing immutable `flutterwave_live_authority_reviews.evidence_sha256`.
It binds:

- LIVE environment and provider;
- exact merchant scope, school ID and school subaccount ID from the DB review;
- explicit `dashboardFeeBearer: "MERCHANT"` and the digest of reviewed dashboard
  evidence;
- explicit LIVE-subaccount and school-ownership attestations and the digest of
  reviewed ownership evidence.

Unknown fields, missing evidence, TEST scope, customer/subaccount fee bearer,
unverified ownership and altered document hashes fail closed. Shape validation
of an `RS_...` string alone never establishes a genuine LIVE account.
The caller's document cannot override the DB-authorized recipient or amounts.
Support confirmation alone cannot populate these account-specific attestations.

The canonical document has these fields (placeholders are intentionally not
valid evidence):

```json
{
  "version": 1,
  "provider": "FLUTTERWAVE",
  "environment": "LIVE",
  "merchantScope": "<reviewed merchant scope>",
  "schoolId": 123,
  "schoolSubaccountId": "<actual verified LIVE RS_ ID>",
  "dashboardFeeBearer": "MERCHANT",
  "dashboardFeeBearerEvidenceSha256": "<64 lowercase hex characters>",
  "liveSubaccountVerified": true,
  "schoolOwnershipVerified": true,
  "schoolOwnershipEvidenceSha256": "<64 lowercase hex characters>"
}
```

`liveSplitAuthorityDigest` canonicalizes this strict document before hashing.
The approved review row commits that canonical digest, not an arbitrary opaque
bundle digest. Referenced source artifacts must be independently reviewed and
retained securely; hashes and true booleans are not independent verification.
Do not store secrets, raw bank/customer data or source artifacts in snapshots.
No account review has been populated or approved by this change.

The validated document and server-built allocation preview are frozen into the
existing intent authority snapshot. Before **first** activation, the lifecycle
rechecks the document against the original unexpired DB review hash; rejection
rolls back financial finalization and leaves a reconciliation case. Completed
immutable issuance is replayed unchanged. Old generic hashes/design snapshots
are not automatically upgraded, rewritten or approved.

No new database column or migration is needed for this change. No HTTP
checkout/authority-review creation endpoint has been enabled. The read-only
evidence-preview endpoint does not create a review. A separately approved
audited Owner evidence-import/issuance integration is still needed before
operational use; caller-submitted booleans must never become approval.

## Release gates that remain closed

`flutterwaveLiveStatus` now separates the confirmed split model from outstanding
account evidence, explicit migration approval, hard-disabled workflow and
independent verification transport, and unreleased durable webhook finalization.
Its `configurationReady` describes credential/runtime wiring only.

The following remain unchanged:

- `checkoutEnabled` and `providerTransportEnabled` are hard-coded false.
- Default workflow capability is disabled, before acquiring a DB connection.
- LIVE independent verification transport refuses before outbound readers run.
- LIVE ingress authenticates separately from TEST and attempts receipt
  persistence, but still returns HTTP 503 / `processed: false`, even if the
  receipt is recorded. Persistence is not financial acknowledgement.
- No environment flag, confirmed support model or supplied evidence overrides
  these gates. No fallback to unscoped TEST/SANDBOX records is allowed.

## Exact remaining approval and configuration sequence

1. **Merchant dashboard:** an authorized operator must inspect the actual LIVE
   account, verify fee bearer Merchant at the support-specified path, and retain
   reviewed evidence. Do not infer it from a secret's existence or support email.
2. **School recipients:** obtain each genuine LIVE school subaccount ID and
   establish school ownership and merchant association. Retain independently
   reviewed LIVE evidence; do not reuse TEST IDs or infer environment from `RS_`.
3. **Schema approval:** independently verify the intended application database,
   actual schema and migration ledger. Obtain explicit target-specific approval
   before applying the existing four review-only drafts, in order:
   - `lib/db/dev-reconciliation/flutterwave-live-webhook-inbox.up.sql`
   - `lib/db/dev-reconciliation/flutterwave-live-finalization.up.sql`
   - `lib/db/dev-reconciliation/flutterwave-live-workflow.up.sql`
   - `lib/db/dev-reconciliation/flutterwave-live-readiness.up.sql`
   They are not automatically journalled or safe to blindly rerun. Rollback is
   reverse order and must preserve populated financial/audit evidence.
   The last read-only Development review found no `flutterwave_live_*` tables.
   Reverify that state at approval time; this implementation does not apply DDL.
4. **Approved authority custody:** through a separately approved audited Owner
   review/import flow, append the canonical evidence commitment with correct
   reviewer, merchant, school, recipient and bounded expiry. Preserve old reviews.
   Do not manufacture these records from the example above.
5. **Webhook readiness:** independently confirm LIVE-specific verifier binding,
   actual dashboard webhook version/authentication, correct public HTTPS routes,
   refund/custom URL and chargeback settings. Preserve TEST verifier separation.
   This work has not inspected or changed any dashboard/secret.
6. **Durable processing release:** complete/review operational issuance,
   independent transaction-bound school/merchant evidence, durable receipt/event/
   collection/activation processing, duplicate/lost-response recovery and
   refund/dispute holds. Missing fee components remain unknown; do not guess VAT,
   merchant bank credit or refund completion. An authenticated webhook or
   collection success alone is not settlement evidence.
7. **Explicit real-money authorization:** a separate reviewed release decision
   must authorize any controlled LIVE checkout and subsequent money movement.
   Changing flags alone does not enable this code. Once deliberately released,
   creating a LIVE checkout is a real payment session and a completed payer
   payment moves real money. First-payment/settlement acceptance needs its own
   authorized recipient, amount and reconciliation scope.

No Flutterwave API, real checkout, refund or transfer is used by focused tests.
Native workflow tests use an isolated fictional PostgreSQL cluster and injected
fictional verification evidence, never the application database.

## Focused verification — 2026-10-21

- 56 unit/configuration cases passed across
  `flutterwave-live-split-authority.test.ts` and
  `flutterwave-live-config.test.ts`.
- 70 isolated native PostgreSQL/HTTP workflow cases passed using the actual
  ingress factory, including authentication-before-DB, disabled defaults,
  delivery retries, lost receipt commit response, adverse hold/replay, exact-byte
  recovery and Owner read-only hash-bound preview/denial cases.
- 20 isolated native finalization and 4 read-only preview unit cases passed.
  Together with the 56 unit/configuration cases, this is **150 API tests**.
- Frontend coverage verifies local import, invalid/oversized/unreadable files,
  late file/request responses, evidence mismatches, access changes and failure
  states; see the current [verification report](flutterwave-live-evidence-preview-and-ingress.md).
- Generated shared-library, API and frontend TypeScript, API/frontend builds and
  `git diff --check` passed. Development services restarted successfully.
- The screenshot browser renders the sign-in page, not the protected Owner
  screen. Authenticated application browser acceptance is a separate follow-up;
  DOM and isolated SQL evidence are not presented as that acceptance.
- No new application migration, actual provider interaction or real-money
  acceptance is established by these results.
