# TEST / NOT REAL — local no-partner split simulation

This separate Development-only, active-Owner-only screen is available at
`/flutterwave-split-simulation`, linked from the Owner split dashboard.
Its dedicated GET/POST endpoint is `/api/flutterwave/local-split-simulation`.
Services were not started to implement or test it.

## Not an operational fixture

School 1496 (Academic Calendar QA) is a hard-coded example label only. The
simulation never reads or writes school, student, subscription, recipient,
configuration, payment, receipt, attribution or settlement records. No database
migration, seed, bank encryption or provider credentials are required.

The business/contact/bank fields are explicitly TEST / NOT REAL. The email uses
the reserved `.invalid` domain; bank code/account/phone and recipient identifier
use `SIMULATION_NOT_REAL_` strings, not valid bank numbers or provider RS IDs.
There is no association with the existing diagnostic subaccount reference.

## Workflow

Preview -> acknowledge fiction -> simulated review -> simulated enable/disable
-> reset. Each server response is calculated from the current action. State is
only in the page's identity-scoped query cache; reload/fresh preview resets it.
No shared/server state is stored. Acknowledgement is not an ownership attestation.

Amounts: NGN 5,000 total; NGN 2,000 school; NGN 3,000 Yetenia platform gross;
no Partner. Provider fees are excluded, net is not calculated, and no actual
allocation, ownership, provider verification or settlement is proven.

## Fail-closed barriers

- Both route and builder require NODE_ENV=development and no deployment flag.
- Only an authenticated active platform Owner can access the endpoint.
- Strict input permits only example 1496, local preview/review/enable/disable/reset
  actions and a fictional acknowledgement. No bank, provider binding, readiness
  or operational settings can be injected.
- Every response fixes recipientState=LOCAL_ONLY_UNVERIFIED and all operational,
  readiness, ownership, provider, checkout, webhook and settlement flags false.
- The API routing barrier rejects labelled/marked simulation data on operational
  routes before handlers run. Payment webhooks have a raw-body barrier before
  processing; signed bytes are not altered.
- Recipient submission/review and split checkout/collection services reject
  simulation markers before database work. Provider HTTP transport and checkout
  initialization also reject simulation markers before network use.
- Fixture IDs cannot resolve to persisted recipient/payment IDs. No promotion or
  conversion endpoint exists. Legitimate future onboarding must create a separate
  operational recipient with genuine information and normal Owner verification;
  the simulated recipient can never be upgraded.

These barriers reject known fixture data, not arbitrary malicious data with every
marker removed and fabricated legitimate identifiers. Existing operational
authorization, strict schemas and recipient readiness requirements still apply;
simulation is not an alternative authorization credential.

## Verification boundary

Offline tests cover pure results, HTTP handlers invoked in-process (no listener),
mock authenticated roles, operational/provider barriers and actual React UI
interactions with mocked API hooks. They do not establish real Clerk/browser
acceptance or Flutterwave allocation behavior. Viewing the screen in the running
app requires separate permission to start Development services. No real payment
is needed to exercise this local simulation.

### Full application and raw-webhook regression tests

`artifacts/api-server/src/app.local-split-simulation.test.ts` imports the actual
Express app and route registry. Requests are in-memory streams, not HTTP clients;
no listener is created. Database, identity and provider boundaries throw if used.
Fetch and socket connections are blocked, including loopback. Tests exercise all
three actual raw payment-webhook mounts, unchanged ordinary bytes, invalid
signatures, synthetic valid/tampered HMAC controls, parser limits, route exemption
boundaries, role checks and Development/deployment gating. A synthetic
NODE_ENV=production test changes only the test process label, never a database
target or Production environment.

### Controlled offline desktop/mobile browser checks

Build the isolated real-component fixture with:

```sh
pnpm --filter @workspace/edupulse exec node scripts/build-offline-split-review.mjs
```

This writes only `/tmp/educore-offline-split-review.html`; it starts no service.
The entry uses the real review component, shared Button/currency formatter, app
CSS and pure fictional builder. It does not import the app entry, Clerk or API
hooks. External font imports are removed, remote CSS is rejected, and a restrictive
CSP blocks network and form submissions.

Load the HTML into an offline browser with all HTTP/HTTPS/WebSocket requests
blocked. Do not substitute a running app URL. At 1440×1000, 390×844 and 320×740:

1. Open review and check TEST / NOT REAL, LOCAL_ONLY_UNVERIFIED, no Partner,
   ₦5,000 total / ₦2,000 school / ₦3,000 Yetenia gross and fee exclusions.
2. Wait at least one second, click inside and outside; review must stay open.
3. Measure `document.documentElement.scrollWidth <= clientWidth`; text must wrap
   without clipped descendants and Close must be reachable by normal scrolling.
4. Confirm fictional review; recorded/unverified status must remain visible.
5. Explicitly close, then reopen. Accidental form-submission count must stay zero.

This is component acceptance, **not authenticated full-app Owner acceptance**.
The app's 320px minimum body width was removed after the narrow check exposed
horizontal overflow when a vertical scrollbar reduced the available width.
