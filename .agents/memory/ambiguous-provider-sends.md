---
name: Ambiguous provider sends
description: Why externally sent notifications must not be blindly retried after uncertain provider acceptance.
---

If an SMS or email attempt might have reached the provider but the worker did not durably record the response, leave it for reconciliation rather than automatically sending it again. Explicit provider rejection, such as rate limiting, can use bounded retries.

Commit the recoverable invitation claim or token hash and dispatch identity before asking the provider to notify. An error message saying “recovery required” is not sufficient: retry protection must survive transaction rollback and process restart.

Guard an unresolved attempt by its stable selected-source identity across operation types and recipient changes, not only by the new target email. A different email-edit target or a switch between resend and email correction must not bypass the outstanding attempt.

**Why:** A provider may accept an outbound message just before a timeout or database failure. Without provider-side deduplication or a verified delivery receipt, retrying that attempt can duplicate SMS messages, charges, and sensitive content. A database claim alone does not make the external send exactly-once. Target-email-only guards allowed a second correction to bypass a still-uncertain first correction against the same invitation.

**How to apply:** Keep this distinction in future communication workers, manual retry actions, provider swaps, and delivery-receipt integrations. Test accepted-but-lost responses as well as ambiguous commits. Only resume an uncertain send after a trusted provider reconciliation proves it was not accepted or a provider-supported idempotency key makes repetition safe.