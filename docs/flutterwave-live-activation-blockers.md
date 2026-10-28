> **ARCHIVED split release assessment.** Resolving any old subaccount/split blocker does not permit release or payment. Current Replit-only no-split requirements: `january-2027-no-split-payment-policy.md`.

# Flutterwave LIVE activation — blocked, not operational

## Development implementation update

The separately gated SCV3 runtime is now implemented. See
`flutterwave-live-runtime-release.md` for its default-disabled checkout,
callback, independently verified signed-webhook finalization, migration drafts
and release checks. The observations below describe the pre-implementation
inspection; they are not a claim that those code gaps still exist.
No application database migrations or Production settings were changed.
Operational prerequisites remain outstanding.

## Inspection scope

Read-only configuration, source and Production-routed database inspection on
2026-10-24. No provider request, charge, record repair, migration application,
mode change or publishing was performed. Secret existence was checked through
Replit's secure configuration interface; secret values were not retrieved.

## Approved allocation

- V3 hosted checkout: NGN 5,000.
- Exactly one school instruction: the school's real LIVE subaccount ID,
  `transaction_charge_type: flat_subaccount`, `transaction_charge: 1900`.
- Merchant absorbs gateway fees; customer must be charged exactly NGN 5,000.
- Eligible Partner liability: NGN 100 internally after independent verified
  success, never a second checkout subaccount. Existing attribution and term-end
  approval rules remain in force.
- Yetenia receives the NGN 3,100 merchant gross remainder less actual gateway
  fees; eligible internal Partner liability reduces its economic share by NGN 100.
- Never repurpose old TEST/SANDBOX payment, recipient or subscription records.

## Configuration and release blockers

1. `FLUTTERWAVE_LIVE_SECRET_KEY`, `FLUTTERWAVE_LIVE_PUBLIC_KEY` and
   `FLUTTERWAVE_WEBHOOK_VERIF_HASH` exist. Presence does not prove credential
   validity, account authorization, or that the dashboard uses the same hash.
2. Production secure configuration inspection did not find
   `EDUCORE_FLUTTERWAVE_MODE=LIVE`,
   `EDUCORE_FLUTTERWAVE_LIVE_ENABLED=true`, or
   `EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT=LIVE`. Do not set these until the
   separate release prerequisites are met.
3. `FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH` is absent. Preserve the existing TEST
   dashboard verifier in that dedicated secure secret before binding the shared
   verifier to LIVE. Do not copy, display or rotate its value in chat.
4. Configure and review each school's actual LIVE Flutterwave subaccount under
   the intended merchant account, with school ownership and merchant fee-bearer
   evidence. The current `flutterwave_split_recipients` path is TEST-only.
   `RS_SCHOOL_LIVE_SUBACCOUNT_ID` is invalid, not a configuration value.
5. The Production-routed read-only database exposes no `flutterwave_live_*`
   tables. This is a replica observation, not proof of the deployed application's
   exact writable target. Verify that target, review the additive LIVE migration
   drafts and obtain migration approval before applying them. Do not mix LIVE
   financial data into the historical unscoped/SANDBOX tables.
6. Source intentionally blocks LIVE provider transport, independent
   verification, runtime workflow capabilities and application entitlement
   wiring. Supplying secrets or environment flags does not release those gates.
   They require coordinated implementation and verification, not flag bypasses.

## Callback and webhook

The deployment service confirms `https://educore.yetenia.com` as the primary
published URL. `PUBLIC_APP_URL` is absent in the inspected secure configuration,
but the existing student subscription URL helper has a canonical Production
fallback. Its existing return target is `/subscriptions`, with persisted
subscription/payment identifiers. That path is not evidence of a working LIVE
intent callback; the present LIVE path has no released hosted-checkout workflow.
Do not invent `FLUTTERWAVE_CALLBACK_URL` as an activation control: current
subscription code does not consume it.

The existing LIVE webhook route is:
`/api/webhooks/flutterwave/live/student-subscription`.
It authenticates the V3 `verif-hash` before database access, but intentionally
returns 503, even when injected fixture finalization succeeds. It is not a
released payment processor and must not be reported as operational. Preserve
the separate existing TEST webhook.

## Acceptance required before release

Use only disposable fictional fixtures until operational prerequisites are
approved. Independent provider evidence must bind success, NGN, 500000 minor
units, exact tx_ref and transaction ID, charged amount, actual fees and the
school's 190000-minor-unit allocation. Echoed checkout metadata is not proof of
school allocation. If V3 verification does not supply sufficient independent
allocation evidence, reconcile through an approved provider evidence source;
never mark paid from the webhook or browser redirect alone.

Existing LIVE fixture finalization covers unique collection/evidence records,
transaction-bound allocation audit, accrued Partner liability, concurrent replay,
commit uncertainty, mismatched evidence and protective holds. These tests do not
constitute released LIVE transport or real merchant settlement acceptance.

Flutterwave's currently served split documentation contains conflicting wording
about `flat_subaccount`; preserve the user's written approved model and require
the exact provider allocation evidence rather than inferring settlement from
the checkout instruction alone.
