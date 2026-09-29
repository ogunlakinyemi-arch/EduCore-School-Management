---
name: Ambiguous provider sends
description: Why externally sent notifications must not be blindly retried after uncertain provider acceptance.
---

If an SMS or email attempt might have reached the provider but the worker did not durably record the response, leave it for reconciliation rather than automatically sending it again. Explicit provider rejection, such as rate limiting, can use bounded retries.

**Why:** A provider may accept an outbound message just before a timeout or database failure. Without provider-side deduplication or a verified delivery receipt, retrying that attempt can duplicate SMS messages, charges, and sensitive content. A database claim alone does not make the external send exactly-once.

**How to apply:** Keep this distinction in future communication workers, manual retry actions, provider swaps, and delivery-receipt integrations. Only resume an uncertain send after a trusted provider reconciliation proves it was not accepted or a provider-supported idempotency key makes repetition safe.