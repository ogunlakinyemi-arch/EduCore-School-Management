---
name: Student finance and teacher record visibility
description: Role boundaries for student fees and assigned teacher class/student reads.
---

Students should see school-proposed/parent-facing fees, never the platform's
subscription price or instructions for the school's platform payment. A legitimate
school invoice may coincidentally equal the platform price; distinguish financial
sources, never filter by the numeric amount.

**Why:** The user explicitly requested student price privacy while retaining
School Admin/Owner views, pricing, financial history and existing access gates.

**How to apply:** Review alternate student entry points and shared fee totals,
not only the subscription panel. Keep school-issued invoices visible; do not
rewrite financial records or imply that a fee display changes NFC eligibility.

Teachers may read classes, student pickers and attendance only through their
own current school's explicit current assignments. An entered ID, matching class
name, historical assignment or frontend option is not authorization.

**Why:** The user requires assigned-record dropdowns and server-side isolation,
including a safe no-assignment empty state.

**How to apply:** Bind authorization to the authenticated teacher, tenant,
current employee/session and assignment records. Preserve ordinary School Admin
and Owner oversight. Exercise both direct-ID denials and list filtering.
