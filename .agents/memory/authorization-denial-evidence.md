---
name: Authorization denial evidence
description: Distinguishing confidentiality failures from incorrect HTTP-status expectations in acceptance tests.
---

Do not change a resource-masking denial just to satisfy a tester's assumed HTTP status. A denied request may correctly return 404 with ACCESS_DENIED instead of 403.

**Why:** An authenticated acceptance pass stopped at an invented 403 requirement even though the unauthorized actor received only a denial, no private document bytes, and the authorized actor received the resource successfully.

**How to apply:** Compare the denial with the actual route contract and the user's requirements. Verify the real actor, absence of private content, and a successful authorized request to the same resource. Keep intentional anti-enumeration behavior; distinguish an incorrect test assertion from a product defect.

For a test aimed at a later safety gate, satisfy earlier eligibility and consent gates with a legitimate fixture. An earlier correct denial does not prove the intended later check.

**Why:** An Owner channel-policy fixture used an SMS event outside the permitted scope and lacked consent, so it never exercised the policy denial it claimed to test.

**How to apply:** Establish valid event scope, recipient authority and explicit consent before testing a channel-policy rejection. Keep production safeguards unchanged.
