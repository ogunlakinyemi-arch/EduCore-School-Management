---
name: Webhook-independent test checkout
description: Why a missing Flutterwave webhook hash need not disable strictly test-mode checkout and server verification.
---

Strictly test-mode Flutterwave checkout and independent server-side verification may operate without a configured webhook verification hash, but the webhook must reject every request until its separate hash is configured. Never substitute the encryption key, public key, or API secret for that hash. A browser redirect alone must never settle payment.

**Why:** Checkout verification can independently query the provider against a persisted payment reference, amount, and currency, while an unauthenticated webhook cannot be trusted. Disabling all checkout because webhook authentication is pending unnecessarily blocks the safe verification path; accepting an event without its separate secret would compromise settlement.

**How to apply:** Keep missing webhook configuration a clearly reported limitation rather than a silent fallback. Verify the authenticated reconciliation path and webhook rejection separately, and do not claim real payment completion from mocked responses or an authentication-only provider probe.