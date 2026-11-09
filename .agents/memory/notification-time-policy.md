---
name: Notification time presentation
description: Lagos/WAT display rules without changing stored UTC event instants.
---

Display notification event and creation times consistently in Africa/Lagos,
explicitly labelled WAT. Event occurrence and notification creation are distinct
instants and may legitimately differ. Preserve UTC storage and API timestamps.

**Why:** The Owner reported that ISO UTC in message bodies beside local-time
cards confused parents and explicitly requested consistent WAT presentation.

**How to apply:** Convert only at display/outbound-message boundaries, including
generic push created-time labels. Use the same date/time format and precision,
handle midnight/year rollover, and never convert already formatted WAT twice.
