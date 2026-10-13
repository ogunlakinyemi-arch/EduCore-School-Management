---
name: Vendor delivery gate
description: User's delivery prerequisite for physical NFC/GPS/device integrations and vendor-dependent verification.
---
The user reports vendor hardware/software is still awaiting delivery. Physical NFC/GPS/device integration, vendor API setup, vendor communication/retry testing and hardware-dependent features must remain unchanged until that prerequisite is met.

**Why:** The user explicitly separated safe software remediation from work that depends on vendor delivery.

**How to apply:** Keep software-only mock verification distinct from physical/provider evidence. Obtain confirmation that the vendor prerequisite is met, and any necessary live-action approval, before device integration changes or genuine vendor-dependent tests.
