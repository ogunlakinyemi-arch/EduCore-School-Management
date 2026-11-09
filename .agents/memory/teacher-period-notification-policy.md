---
name: Teacher period notification scope
description: Approved Development-only teacher reminder scope and deferred Telegram support.
---

Teacher period notifications are Development-only: five minutes before the scheduled start and at the scheduled end, for the teacher selected on the timetable with a valid subject-teacher or class-teacher assignment. Dual assignments must not duplicate notifications.

**Why:** The user requested a small, low-credit change and then explicitly chose In-app and push only after learning that the existing Telegram linking and consent model is parent-only.

**How to apply:** Keep teacher Telegram unsupported unless separately approved. Reuse school timezone, queues, Owner selections, registration/consent, audit and deduplication; revalidate queued pushes against timetable changes and expiry. Do not enable channels, select recipients, unpause workers, bypass payment-test safeguards or perform real test sends as part of this feature. Schema changes require stopping and reporting before applying.
