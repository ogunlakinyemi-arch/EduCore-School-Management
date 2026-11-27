---
name: School fee beneficiary authority
description: School-owned transfer instructions require official-school identity verification, independently of subscription or merchant settlement.
---

School-fee bank destinations must match the school's registered/official name,
not a School Admin's personal name. Existing enabled/manual destinations are not
verification evidence. Parent invoice disclosure requires verified evidence and
explicit school enablement.

**Why:** The user requested automatic bank resolution consistent with Owner/BRO
verification while keeping school fees separate from EduCore subscription and
Flutterwave merchant settlement. They explicitly forbid Development/Sandbox
verification of real accounts.

**How to apply:** Preserve the dedicated LIVE guard and exact conservative name
rule, including rejection rather than fuzzy aliases. Do not promote legacy rows,
infer operational lookup authorization from available credentials, or change
payment/commission rules while repairing this setup.

School Admin school-fee collection is the school's own bank-transfer or cash
process. Keep collection-method controls separate from gateway/provider
configuration; retain original historical payment methods in storage and reports.
Student and Teacher platform subscriptions remain separate payments to Yetenia
through Flutterwave under their existing rules.

**Why:** The user explicitly requested simple school-managed fee collection
controls, not a gateway/bank choice implying that Yetenia collects school fees.

**How to apply:** Keep optional school bank-account setup separate from recording
and filtering collections. UI simplification does not authorize reclassifying
historical records, changing verification or altering provider configuration.

The school NFC charge is a built-in category, not a category a school must
create manually. Its school-entered amount is required and strictly positive,
without a suggested/default platform amount. Saving or publishing a schedule
containing this charge must not automatically issue invoices.

**Why:** The user explicitly required an amount-only school NFC charge option
while preserving invoice history and the separate student/teacher platform fees.

**How to apply:** Keep academic scope explicit, retain versioned drafts, and
require a separate final invoice-assignment action. School charges never grant
platform access or replace Flutterwave platform-subscription verification.
