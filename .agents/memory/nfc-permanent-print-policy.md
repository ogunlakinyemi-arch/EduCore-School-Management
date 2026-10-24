---
name: Permanent NFC print policy
description: Student card lifetime and separation of printing from NFC activation.
---
Student cards last until graduation. The Student front identity details must be ONLY Name, permanent Registration/Admission Number and the assigned NFC card UID. Do not print class or other student fields. The opaque verification QR is separate and is never a substitute for the printed NFC UID. Teacher/Staff designation requirements remain unchanged.

Printing and reprinting are read-only: no new identity or assignment, activation, unlocking, or lifecycle transition. Teacher cards must be printable immediately after the existing assignment workflow, even before personal activation.

**Why:** The user explicitly corrected the temporary class requirement: students keep the same card until graduation. The existing Teacher assignment and activation stages remain separate; downloading must not grant active device access.

**How to apply:** Derive all three Student identity fields from the current authorized records, omit class/session/term/subjects and retain employee designation. Validate identity/lifecycle and tenant scope on every preview/download. QR verification remains opaque, reveals no personal data and grants no access.

Use the supplied Student NFC ID reference as the visual basis for both Student
and Teacher/Staff variants. Student decoration colors must be extracted from each
school's logo, NOT fixed blue/cyan/green. Darken the dominant hue for white text
and NFC icon readability, use other logo hues or tonal accents, and fall back to
the saved school primary/restrained default only when extraction fails. Employee variants
use a distinct alternate logo hue or complementary fallback, not the Student
dominant band or configured employee colors. Never copy the reference child's portrait,
example identity or example QR into actual cards.

**Why:** The user supplied a Student reference after requesting both Student and
Teacher/Staff designs, then explicitly clarified: "the color decoration should
be extracted from the school logo." Preserve the layout, not the example colors.

**How to apply:** Preserve the shared school-first design family and use only
authorized current school/person images and identity data in real renders.

Employee cards follow the supplied school-first Parent/Guardian reference layout
without creating Parent/Guardian cards. Label the actual employee type precisely:
Teacher, Staff, Driver or other supported school employment type (e.g. Accountant).
Keep employee number/department details; never add student class. The reverse is
Yetenia Technologies Limited ownership and EduCore product/contact branding only,
not school-specific ownership or school contact details.

**Why:** The user explicitly requested distinct logo-derived employee colors,
role-specific labels including Driver, and "Let the back be yetenia details."

**How to apply:** Keep preview and downloaded CR80 output on the same renderer,
preserve scoped read-only printing eligibility, and do not broaden attendance,
billing or device permissions merely to support a printable role.

Official Student, Teacher and Staff card generation, download, print, issue, reprint, assignment, reassignment, activation and replacement are Platform Owner-only. School Admin access is preview-only. Teachers must not preview Student ID cards.

**Why:** The master correction requirements explicitly separate official card control from normal school operations; older School Admin lifecycle permissions must not be retained.

**How to apply:** Enforce the boundary on the backend as well as every card action in the UI. Do not broaden Owner permissions into ordinary school operations.

Teacher UI status can be an effective payment-blocked status, rather than the stored assignment stage. Offer a download for the payment-blocked assigned card and let the read-only backend validate its underlying lifecycle; never require activation just to print.

**Why:** A real Owner assignment returned an effective locked status while the stored assignment was still awaiting activation. Gating print controls only on the stored-stage names hid all print actions.

An active student's current assigned identity can be previewed before the physical NFC card is activated. Preview must never activate or unlock the card, and preview eligibility must not silently broaden existing download/print eligibility.

**Why:** The Owner's assignment-to-view workflow must work while NFC access is still locked; the requested correction explicitly preserves existing printing permissions and unrelated activation behavior.

**How to apply:** Validate the actual current school/person/card relationship, permit read-only viewing independently of activation, and retain revoked/inactive/conflicting-assignment denials. Treat changes to printing eligibility as a separate request.