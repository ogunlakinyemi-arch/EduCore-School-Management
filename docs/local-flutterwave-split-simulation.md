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
