---
name: Device reassignment history
description: Why historical device-related records cannot reference a device's current school binding
---

Keep historical device credentials, attendance, biometric enrollments, card last-device references, and assignment records bound to the school they belonged to at the time. Do not constrain those historical rows with a composite foreign key to the device's *current* school.

**Why:** Reassigning a device would violate such a foreign key and prevent legitimate moves or force rewriting history. Fixing attendance alone did not suffice when a prior-school biometric enrollment still referenced the current device assignment. Runtime ingestion instead checks that an active credential belongs to the device's current school, and reassignment revokes the old credential.

**How to apply:** When adding any device-related historical reference, use a durable device-school binding instead of the current assignment; enforce the current tenant binding at the ingestion boundary under the applicable lock/transaction.