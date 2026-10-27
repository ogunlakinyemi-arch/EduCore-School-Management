# Integrated Flutterwave payment mode

The sole mode selector is the server-side, non-secret setting:

```text
EDUCORE_FLUTTERWAVE_MODE=TEST
```

Set it to `LIVE` only after the prerequisites below have been reviewed. An unset
selector defaults to TEST. Invalid, blank, lowercase or padded values fail closed.
Neither a browser parameter, credential presence nor a legacy flag selects LIVE.
`EDUCORE_FLUTTERWAVE_LIVE_ENABLED` and
`EDUCORE_FLUTTERWAVE_WEBHOOK_ENVIRONMENT` are obsolete and ignored.

## TEST

- Use `FLUTTERWAVE_TEST_SECRET_KEY`. Existing Development installations may use
  `FLUTTERWAVE_SECRET_Test_Key`; the existing conflict checks remain in force.
- Prefer `FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH`. The legacy
  `FLUTTERWAVE_WEBHOOK_VERIF_HASH` is accepted only in TEST and must not equal the
  dedicated LIVE verifier.
- TEST webhook route: `/api/webhooks/flutterwave/student-subscription`.

## LIVE prerequisites

LIVE remains production-runtime-only. A Development workflow never becomes a
LIVE payment processor merely because the selector says LIVE.

1. Configure the dedicated `FLUTTERWAVE_LIVE_SECRET_KEY` and
   `FLUTTERWAVE_LIVE_WEBHOOK_VERIF_HASH` through Replit Secrets. Generic, shared,
   TEST, public and encryption credentials are never substitutes for LIVE.
   Use a distinct dashboard verification secret of at least 16 characters.
2. Set `PUBLIC_APP_URL` to the reviewed canonical HTTPS production application
   origin/base path. Development domains and unsafe URLs are rejected.
3. In the Flutterwave **LIVE** dashboard, register
   `<PUBLIC_APP_URL>/api/webhooks/flutterwave/live/student-subscription` and the
   dedicated LIVE verification secret. Set the non-secret
   `FLUTTERWAVE_LIVE_WEBHOOK_URL` to that exact registered URL. This setting
   records the operator's registration expectation; it is not a provider lookup
   or independent proof of dashboard registration. Do not use the TEST route or
   checkout redirect as the webhook URL.
4. Retain `EDUCORE_FLUTTERWAVE_RELEASE=SCV3_V1` and the approved
   `EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE`. These are release/merchant evidence,
   not mode selectors. The existing enabled, verified database release manifest,
   schema and immutable-history guards are still mandatory. Configuration never
   creates or repairs them.
5. Each school needs its existing **LIVE**, unexpired merchant/school-matched
   authority review and configuration, including the verified school-owned
   subaccount and approved settlement evidence. TEST approval is not LIVE proof.
   Independent provider transaction verification and reviewed transaction
   allocation evidence remain required before idempotent activation.

Only then select `EDUCORE_FLUTTERWAVE_MODE=LIVE`. No TEST credential or secret is
used if LIVE is incomplete. LIVE does not require unrelated TEST credentials.
Owner readiness checks report configuration blockers without returning secrets.
Complete/reconcile outstanding TEST attempts before switching modes: a
mode-specific endpoint never falls back to the other mode.

## Operational boundary

Code builds do not prove that the currently running API loaded the changes.
Do not restart automatically: verify database isolation and startup worker
behavior, then obtain separate restart authorization. Normal startup currently
starts Telegram and database-target verification before the general worker-pause
check. Deployment/publishing, database changes and provider calls require their
own authorization. No new service, database or schema is introduced by this
configuration change.
