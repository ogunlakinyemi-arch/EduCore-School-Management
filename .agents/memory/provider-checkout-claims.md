---
name: Provider checkout claims
description: Why uncertain hosted-checkout initialization must fail closed rather than automatically retrying the external call
---

An expired local checkout initialization claim does not prove the provider failed to create a chargeable session. Do not automatically initialize again with the same reference after a timeout; keep the invoice reservation and reconcile the provider's independently verified status. Release it only on a matching, confirmed terminal failure. Unknown, missing, pending, or network-error responses leave it reserved.

**Why:** A provider response can arrive after the application's lease expires. The lease fences database writes, not the external operation; a second external call may produce another payable checkout even when the first eventually succeeds.

**How to apply:** Use this rule whenever changing provider initialization retries, abandoned-checkout handling, or reconciliation. A verified success settles atomically; a late success after a released reservation requires explicit reconciliation rather than a second automatic invoice credit.