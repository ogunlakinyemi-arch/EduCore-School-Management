---
name: Settlement profile removal consent
description: Development bank-profile cleanup needs separate record-specific authorization.
---

Permission to build and test a Development-only removal feature does not authorize removing existing Company or School bank profiles. A pending or test-only record is not implicitly disposable.

**Why:** The product owner expressly separated feature implementation/testing from deletion of the existing profiles or any other existing records.

**How to apply:** Use synthetic records in a disposable database for mutation tests. Review exact existing profile IDs, scope and versions separately, then obtain explicit deletion authorization before removing any existing profile. Do not treat a prior implementation request as cleanup consent.
