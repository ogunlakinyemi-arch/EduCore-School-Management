---
name: Automatic student NFC finance
description: Legacy school-fee reconciliation and accounting boundaries for automatic NFC subscriptions.
---

Preserve paid school-configured NFC fee history. A school-fee payment is not evidence of a verified Platform Owner Flutterwave NFC payment. Prevent a second charge for the same student/session/term and flag the legacy charge for Owner reconciliation.

**Why:** The user explicitly chose this approach after a paid ordinary-fee invoice was found to contain an NFC subscription line without a corresponding platform subscription payment.

**How to apply:** Reuse the existing subscription ledger and verification/settlement architecture. Do not rewrite the original invoice, invent a verified payment, or move money while adding automatic subscriptions.

The Teacher-side allocation remains school revenue, not personal Teacher earnings or an amount a Teacher pays. Preserve existing Partner deductions from the platform bucket.

**Why:** The user explicitly required the existing accounting model rather than a new payment or teacher-income system.

**How to apply:** Expose only allocations authorized for assigned classes; never credit individual teachers merely because their pupils paid NFC subscriptions.

Family combined outstanding totals are informational, not a combined payment request. Ordinary school fees retain the school's configured payment methods; NFC uses its separate fixed-price payment link and independent verification.

**Why:** On 2026-10-09 the user required NFC to appear alongside ordinary fees without routing the combined total through NFC or treating a school-fee payment as NFC verification.

**How to apply:** Reuse the existing NFC subscription ledger and the same applicable class/session/term billing scope as ordinary fees. Keep legacy charges protected. Combined balances must not silently omit NFC when its read fails, and genuine payment actions must remain unavailable until reviewed account approval and settlement configuration.

Attachment's advisory lock and checkout's parent-row locks must be compatible with foreign-key KEY SHARE locks.

**Why:** A previously unbound subscription can be attached while checkout holds its student/subscription rows. FOR UPDATE would block the attachment's foreign-key check while checkout waits for its advisory lock, creating an opposing lock order.

**How to apply:** Keep checkout's non-key financial updates protected without blocking FK attachment, and exercise this overlap against PostgreSQL rather than relying on query mocks.
