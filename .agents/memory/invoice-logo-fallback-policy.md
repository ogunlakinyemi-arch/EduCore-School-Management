---
name: Parent invoice logo fallback
description: Optional invoice branding must not prevent a parent from printing an authorized invoice.
---

Parent invoices must remain printable when a school logo is missing or unavailable. Load saved private branding through existing authenticated storage access, never by exposing public credentials or trusting an external logo origin.

**Why:** The user explicitly requested a clean fallback rather than a blocking invoice-print error. This does not authorize relaxing required branding checks on other school documents.

**How to apply:** Keep financial data and access controls unchanged. Treat logo failure as optional for invoices only; do not fabricate school identity when branding cannot be retrieved.
