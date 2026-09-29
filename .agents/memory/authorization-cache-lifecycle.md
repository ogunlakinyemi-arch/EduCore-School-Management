---
name: Authorization cache lifecycle
description: Avoid a signed-in blank-page loop when tenant initialization interacts with the authorization query.
---

Do not globally reset active queries as part of mounting a child provider beneath an authorization-gated route. Keep authorization query state isolated by signed-in identity instead; a new account must get a fresh cache, while mounting a tenant must not invalidate the parent gate's current query.

**Why:** Resetting an active parent authorization query during the child's mount can put the parent back into a loading state, unmount the child, and repeat indefinitely. It presents as a blank screen with repeated successful authorization requests and no JavaScript exception.

**How to apply:** When changing auth or tenant initialization, verify that sign-out/account switching cannot reuse prior authorization, and that mounting the tenant does not repeatedly refetch or remount the authorization gate. Server authorization remains authoritative.