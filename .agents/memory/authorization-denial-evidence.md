---
name: Authorization denial evidence
description: Distinguishing confidentiality failures from incorrect HTTP-status expectations in acceptance tests.
---

Do not change a resource-masking denial just to satisfy a tester's assumed HTTP status. A denied request may correctly return 404 with ACCESS_DENIED instead of 403.

**Why:** An authenticated acceptance pass stopped at an invented 403 requirement even though the unauthorized actor received only a denial, no private document bytes, and the authorized actor received the resource successfully.

**How to apply:** Compare the denial with the actual route contract and the user's requirements. Verify the real actor, absence of private content, and a successful authorized request to the same resource. Keep intentional anti-enumeration behavior; distinguish an incorrect test assertion from a product defect.
