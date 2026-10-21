# Development evidence preview and actual LIVE ingress preparation

## Scope and limits

This increment accepts the user's written fixed-subaccount/Merchant-fee-bearer
support confirmation without changing business policy:

- Customer: exactly NGN 5,000.
- Exactly one reviewed LIVE school subaccount: `flat_subaccount`, charge 1900.
- No `transaction_split_ratio` or Partner checkout recipient.
- Gateway fees are absorbed by the Merchant.
- Eligible NGN 100 Partner commission is an internal accrued payable for
  term-end Owner approval/export, not an executed payout.

No release flag, dashboard setting, credential, application migration or real
payment/refund/transfer is changed. No Flutterwave API is called by tests.

## Owner review/import preview

Open **Owner → Partners → LIVE readiness** (`/partners/live-readiness`).
In Development, an alternative entry is **Financials → Flutterwave Splits →
Split Settlements → Open LIVE readiness**. The prominent button appears near
the top only when both the TEST dashboard and current authorized context
identify the Platform Owner. It is hidden while authorization is pending,
failed or denied, and is absent from production builds. The Partners page also
has the prominent link above its wrapping tabs, so mobile access does not
depend on horizontal scrolling.

The TEST page explicitly states that it cannot activate LIVE. Its v3 policy
summary distinguishes the school NGN 1,900 checkout allocation from the NGN
3,100 merchant remainder before expenses. Eligible NGN 100 Partner commission
is an internal accrued payable for term-end Owner approval/export, never a
checkout subaccount or immediate payout. The Owner economic share is NGN 3,000
with an eligible Partner, or NGN 3,100 without one, before provider expenses.
These labels do not claim actual bank credit. Historical payment cards retain
their original allocations.

The page and its tab require Platform Owner access. Its API is
`POST /api/platform/live-readiness/evidence-preview`, restricted to authenticated
Owners in Development even while financial workflow capabilities remain blocked.

1. Enter merchant scope, school ID and the exact existing authority review ID.
2. Paste the canonical metadata document described in
   [the confirmed-model checklist](flutterwave-live-confirmed-split-activation.md),
   or import a local JSON file of at most 16 KB. No original artifact, bank data,
   credential or secret should be supplied. File import only reads browser memory;
   it does not upload/store a source file.
3. Run the preview. The API uses a bounded, repeatable-read **READ ONLY**
   transaction. It validates the submitted document against the original
   immutable review hash, exact LIVE merchant/school/recipient scope and expiry.
4. Read the report. A matched document is labelled **bound to an existing review**,
   not independently dashboard-inspected or newly approved.

The response always says `previewOnly:true`, `approved:false`, `persisted:false`
and `activationReady:false`. Missing/changed/expired/wrong-scope evidence yields
no allocation preview. Missing/partial authority schema is explicitly unavailable,
never replaced with invented authority. A failed DB read produces 503, not a
successful report.

The report separates:

- Merchant fee-bearer evidence and LIVE school ownership/merchant association;
- missing LIVE tables and authority columns versus mere table observation;
- target identity, complete DDL/constraint/index/ledger acceptance and explicit
  migration approval, which remain **unverified**, not inferred from table names;
- LIVE webhook environment/authentication and TEST separation, which require
  operator evidence (no secrets are inspected);
- hard-disabled checkout/verification/workflow, unreleased durable webhook
  acknowledgement and separate explicit release authorization.

The page clears results on edits/imports, ignores stale request/file responses,
discards previous input on failed imports and does not persist evidence in browser
storage. A visible existing hash is never labelled matched for invalid evidence.

This does not create or approve an authority review. If no approved matching
review exists, stop at the failed preview. A later audited approval/import flow
needs its own authorization; do not manually fabricate an approved row.

## Actual webhook ingress, isolated lifecycle wiring

The actual application webhook remains
`/api/webhooks/flutterwave/live/student-subscription`. Its exported router factory
accepts server-owned dependencies for a pool, LIVE authenticator, verifier and
workflow capability. The application constructs it with **blocked defaults**;
no request body/header/query or environment flag supplies an enabled capability.

- Validate bounded original Buffer bytes.
- Authenticate before acquiring any database client.
- Persist/deduplicate the delivery and return its stable receipt ID only after
  a confirmed commit. A lost commit response produces 503; provider redelivery
  reconciles the same fingerprint safely.
- Only isolated tests supply a fictional verifier and enabled fixture capability
  to invoke the existing `processLiveWorkflow` kernel with the **same Buffer**.
  No parallel payment/finalization implementation was introduced.
- The kernel retains transaction-safe collection/activation/receipt/accrual,
  semantic event replay protection, adverse holds and reconciliation behaviour.
- Even fixture processing does **not** grant HTTP acknowledgement authority:
  this router always returns **503 / `processed:false`**, never 200.

Raw bodies are not newly stored. Provider redelivery or separately authorized
original-byte evidence is still required. Owner recovery rejects missing bytes
and reencoded JSON/changed whitespace, even when the logical event looks equal.
Inbox claims and fingerprints cannot reconstruct a financial event. Successful
collection replay never releases an adverse hold.

## Exact remaining operator/release steps

1. Independently inspect the actual LIVE dashboard fee bearer at **Settings →
   Business preference → Merchant**, and retain reviewed evidence.
2. Verify each genuine school LIVE subaccount ID, school ownership and merchant
   association. An `RS_` prefix, TEST ID or support reply is insufficient.
3. Independently establish the intended DB target, schema and migration ledger.
   Obtain explicit target-specific approval before applying the four existing
   drafts, in order: **webhook inbox → finalization → workflow → readiness**.
   This increment adds no migration and applies no application DDL.
4. Through a separately approved audited process, establish the immutable Owner
   review commitment and expiry. Use this preview to check it; a match is not a
   new approval or authority to issue a payment.
5. Confirm actual LIVE webhook environment/authentication, correct HTTPS routes,
   TEST verifier separation, retries and refund/chargeback notification settings.
   No dashboard delivery is enabled by this work.
6. Obtain complete independent transaction/school/main-merchant evidence, fee/
   tax and bank-credit reconciliation and adverse-event/recovery acceptance.
   Fictional reports and successful collection alone do not establish settlement.
7. Separately review and authorize any real runtime release, HTTP acknowledgement
   change and controlled LIVE payment acceptance. Defaults stay blocked. Once
   deliberately released, a completed LIVE checkout moves real money.

The existing [migration review](flutterwave-live-migration-review.md) and
[confirmed split checklist](flutterwave-live-confirmed-split-activation.md)
remain authoritative for target-specific approval and preservation.

## Verification — 2026-10-21

| Check | Result |
| --- | --- |
| Actual-ingress/Owner-preview native HTTP/PostgreSQL workflow | 70 passed |
| Native finalization draft PostgreSQL | 20 passed |
| Read-only preview unit tests | 4 passed |
| Canonical authority and disabled configuration unit tests | 56 passed |
| Owner preview and existing term-commission DOM tests | 13 passed |
| OpenAPI generation; shared client/Zod, API and frontend TypeScript | Passed |
| API bundle, frontend build and whitespace diff check | Passed |

API total: **150**; UI total: **13**. Disposable SQL clusters use fictional
accounts and existing draft DDL; no application schema or financial records
are used as fixtures. Unrelated financial histories and all four migration
drafts are unchanged.

Development API/frontend workflows run successfully. The unsigned-in screenshot
shows the existing sign-in page at the protected route, not the Owner form.
Authenticated application browser verification remains unperformed and is
proposed separately; DOM/fictional SQL results are not real merchant/settlement
or authenticated Owner-browser evidence.

### Navigation/UI follow-up verification

- 66 focused UI tests passed across Split Settlements, LIVE preview, Partners
  management/invitation/payout controls and term commissions. Actual React
  routing was exercised from the new TEST-page link into the existing Partners
  LIVE preview; no evidence/financial action was invoked by navigation.
- Coverage includes Owner-only/pending/failed authorization, Development-only
  discovery, wrapping navigation, full-width mobile link styling and unchanged
  historical allocation displays. This is DOM coverage, not an authenticated
  application browser/mobile visual acceptance claim.
- 84 mocked API tests passed, including the existing v3 policy response and
  historical preservation. The two outdated v2 response expectations were
  corrected to match the pre-existing v3 implementation.
- The read-only OpenAPI policy descriptor now admits v2/v3 and the existing
  deferred-Partner flag. Client/Zod code generation and shared-library/frontend
  typechecks passed. Frontend build and diff checks passed.
- No backend allocation, payment, migration or LIVE-gate implementation changed.
