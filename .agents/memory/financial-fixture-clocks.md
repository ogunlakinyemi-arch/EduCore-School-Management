---
name: Financial fixture clocks
description: Future billing/release tests must align JavaScript, PostgreSQL and school calendars without overriding policy.
---

Use independently verified disposable fixtures to align both the JavaScript
clock and PostgreSQL's time expressions when testing future billing windows.
Keep current-free and future-chargeable cases separate, using an actual eligible
school-owned calendar and the applicable grace period.

**Why:** Historic enforcement tests ran during the approved free period and
expected payment restriction; release fixtures had no January second-term
anchor. JavaScript-only time travel also disagrees with database-side current
term, expiry and approval queries. A legacy paid split record cannot stand in
for independently verified direct-payment proof.

**How to apply:** Change fixture dates/expectations, not business-policy
functions or safety gates. Advance both clocks explicitly for expiry tests
rather than sleeping against a frozen clock. Block external networking and
retain real PostgreSQL constraints, transactions, source history guards and
legacy-record comparisons. Never install fixture-clock helpers in an
application database or use them for Production acceptance.
