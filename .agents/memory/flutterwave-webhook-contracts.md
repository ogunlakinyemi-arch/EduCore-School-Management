---
name: Flutterwave webhook contract evidence
description: Version-specific provider documentation is required before assuming webhook authentication or refund payload shape.
---

The V3 and general Flutterwave webhook pages reviewed on 2026-10-19 both document
constant-time verification of the shared `verif-hash`. That documentation is not
proof of the actual merchant dashboard's selected version or matching private
configuration; recheck current provider documentation before changing schemes.

V3 refund notifications can use a standalone body without the usual event/data
envelope. A documented refund `completed` status means initiated/pending
disbursement, not completed customer payment.

**Why:** Assuming every authenticated webhook shares the charge envelope misses
out-of-band refunds; assuming `completed` proves disbursement overstates recovery.
The provider documents HTTP 200, not arbitrary 2xx, as its acknowledgement.

**How to apply:** Authenticate first, bind every supplied transaction/reference
identifier to the original verified payment, and persist a hold for adverse
evidence without asserting refund or transfer completion. Only acknowledge a
durably persisted adverse hold as handled; keep unmatched and uncertain financial
outcomes for independent reconciliation. Never automatically release a hold on
a later successful collection notification.

A verifier confirmed for TEST must not be treated as confirmed for LIVE. When
preparing separate environments, preserve TEST verification independently before
assigning a shared configuration slot to LIVE. An operator's environment label
is an attestation, not evidence that the provider dashboard actually matches.

**Why:** The user authorized disabled LIVE preparation while existing confirmation
covered TEST. Reusing that confirmation could authenticate the wrong environment
or break existing TEST callbacks; configuration alone must not authorize money
movement or a successful acknowledgement without durable processing.

**How to apply:** Require explicit environment binding, refuse cross-environment
credential/verifier fallback, and keep merchant-specific evidence and durable
LIVE event processing as separate release gates. Do not relabel historical
SANDBOX payments as LIVE to avoid a future persistence review.
