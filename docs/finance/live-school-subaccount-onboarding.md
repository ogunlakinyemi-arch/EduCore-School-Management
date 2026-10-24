# Automated LIVE school collection-subaccount onboarding

This is an application workflow, not instructions to create each school's
subaccount in the Flutterwave dashboard. Nothing in this change activates it,
applies a shared migration, changes a Production setting or enables checkout.

## Normal school / Owner workflow

1. School Admin saves the school's existing settlement form, then selects
   **Submit saved school details for LIVE verification**. The server freezes
   an encrypted snapshot of the saved school profile. Caller-supplied accounts,
   provider IDs, modes or statuses are never accepted.
2. Using only the dedicated LIVE credential, the server resolves the Nigerian
   account through `/v3/accounts/resolve` and compares its holder with the saved
   holder using the existing normalized-name rule. A generic or TEST `VERIFIED`
   profile does not count as independent LIVE verification.
3. Platform Owner reviews the masked bank details and business contacts under
   Payment settlement → School oversight. The Owner confirms school ownership,
   separation from Yetenia's account, merchant ownership/KYC and Merchant fee
   bearing. The four document SHA-256 commitments bind school ownership,
   merchant/KYC, fee-bearing and default-split-policy evidence to the decision.
   Commitments refer to independently reviewed evidence; they are not proof
   merely because a browser supplied a hash. Never enter credentials in notes.
4. After configuration, target release, current school/profile, fresh LIVE bank
   verification and canonical Owner authority pass, the server checks for an
   existing uniquely owned provider subaccount. A confirmed existing identity is
   recovered, not recreated. Otherwise it commits an irreversible creation claim
   before making one authorized POST to `/v3/subaccounts`.
5. A numeric ID returned by the provider is retained before GET readback.
   `/v3/subaccounts/:id` must confirm bank, business identity, provider reference
   and reviewed default split. Only then is the record `LIVE_VERIFIED`.

Bank verification expires after 24 hours. Before creation, an Admin can submit
again to refresh verification. Changed details invalidate the old frozen
submission. After any creation claim, a new school submission cannot create
another subaccount; replacement requires a separate reviewed reconciliation.
School deactivation or a concurrent profile change cannot authorize creation.

## One-time deployment prerequisites — separate authorization required

The UI reports missing prerequisites. No values should be printed or requested
through chat. Credential presence alone is not evidence of provider permission.

- Production runtime and explicit `EDUCORE_FLUTTERWAVE_MODE=LIVE`.
- A dedicated `FLUTTERWAVE_LIVE_SECRET_KEY`, with no TEST/generic fallback.
- Approved `FLUTTERWAVE_KYC_APPROVED`,
  `FLUTTERWAVE_SUBACCOUNT_CREATION_CONFIRMED` and
  `FLUTTERWAVE_SUBACCOUNT_DEFAULTS_CONFIRMED` attestations.
- `EDUCORE_FLUTTERWAVE_LIVE_ONBOARDING_ENABLED` and
  `EDUCORE_FLUTTERWAVE_ONBOARDING_RELEASE=SCV3_SCHOOL_ONBOARDING_V1`.
- Reviewed `EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE` and HTTPS `PUBLIC_APP_URL`.
- LIVE webhook binding (`EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT=LIVE`) and a
  valid LIVE verifier, distinct from `FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH`.
- Working versioned payroll bank encryption; retain old versions needed to
  decrypt frozen history. Existing keyring/session-derived encryption behavior
  is reused rather than introducing plaintext or a second unreviewed key store.
- A reviewed company settlement profile for platform-account separation.
- The separately reviewed onboarding SQL draft, with history/audit guards,
  followed by explicit target-specific release approval. The manifest must bind
  the release, merchant, schema version, reviewing Owner and evidence digest.
  The draft creates no enabled release row.

`lib/db/dev-reconciliation/flutterwave-live-school-onboarding.up.sql` is a
review draft. It is NOT in an automatic startup or migration runner. Do not
apply it to an application/shared database without a new target-specific
authorization and preservation review.

The new onboarding release is intentionally independent of
`EDUCORE_FLUTTERWAVE_LIVE_ENABLED` and the checkout release. It does not set
either, create checkout intents, bind financial authority, collect money,
settle funds or accrue/pay commissions. School billing authority/release still
requires its existing separate approval. The subscription allocation remains
₦1,900 school / ₦3,100 Yetenia before provider fees; eligible Partner ₦100
remains an internal accrued liability, never a third collection recipient.
The creation default is the reviewed merchant-flat ₦3,100 policy; checkout's
existing explicit school-flat ₦1,900 instruction is unchanged. Flutterwave's
published split-default wording is inconsistent, so default-policy and
Merchant-fee-bearing evidence are mandatory; this workflow does not infer them.

## Idempotency, uncertainty and isolation

TEST continues to use the Development-only TEST routes/adapter and recipient
table. LIVE uses separate routes, a dedicated transport, LIVE-only records and
statuses. Flutterwave v3 uses the same documented provider host with different
credentials; the application never treats a TEST ID/status as LIVE evidence.
Only the provider-independent bank/ID shape check is shared.

School snapshot uniqueness, active-school/account uniqueness, row locking,
canonical authority checks and a committed, non-resettable creation claim stop
double-clicks, concurrent Owners and response retries from issuing two POSTs.
Flutterwave v3 collection-subaccount creation does not document a reliable
idempotency-key contract; no invented provider retry guarantee is assumed.

If the creation result, readback or local result persistence is uncertain, the
status is `CREATION_UNKNOWN` (or a still-claimed `CREATING`). **Recover** performs
GETs only, using the known numeric ID or an exact bank/business match in a
complete provider list. Zero/multiple matches, incomplete listings, permission
failures, changed bank ownership or a subaccount bound to another school fail
closed. A lost claim-COMMIT acknowledgement also never triggers another POST.
If no definite provider result can be established, investigate the exceptional
case with the provider; do not manually fabricate/enter an ID or blindly reset
the claim. Dashboard investigation is exceptional, not routine onboarding.

Before-POST permission/preflight failures remain retryable after the prerequisite
is fixed. Once a claim exists, retries reconcile only. Automatic provider sends
and browser mutation retries are not used. Raw provider bodies, credentials and
full account numbers are not exposed in diagnostics.

## Local verification

Run from the workspace root:

```
pnpm --filter @workspace/api-server exec vitest run src/routes/flutterwave-live-school-onboarding.test.ts
pnpm --filter @workspace/edupulse exec vitest run src/components/live-school-subaccount-onboarding.test.tsx
```

The API suite starts its own PostgreSQL cluster under a unique private `/tmp`
directory, disables TCP, verifies the socket/data-directory/user identity, applies
the draft only there, and stops/removes that cluster afterwards. Provider calls
are injected mocks. The application's database module is mocked to throw; no
application database URL or real provider credential is used.
