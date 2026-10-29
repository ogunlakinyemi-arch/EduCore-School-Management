# School-branded report printing

Parent, Student and Admin report print actions share an isolated same-origin
print frame. The prepared document does not inherit hidden application ancestors
or retain application-shell pagination. It waits a bounded time for styles,
fonts and authenticated images before invoking native print. Empty content,
blocked frames and required-logo failures produce a visible error instead of a
blank printout. Missing/unloadable optional child photos are omitted.

Branding comes from the authorized school branding API, including its current
logo/contact details and approved saved school colors. Unset colors have neutral
fallbacks. Child photographs come only from the actual same-school student's
managed stored photo through the independently authorized student-photo endpoint.
No stock image, sample-school identity or substitute student photograph is used.

Reports render frozen published subject/component scores, grades and remarks.
They do not recalculate historical grades or invent missing marks, assessment
ratings, remarks or next-term dates. Where stored fields are present, attendance,
teacher/school remarks, affective/psychomotor ratings and next-term dates are
rendered. A4 tables repeat headers and avoid splitting individual rows.

## Verification

A 390×844 fictional parent portal journey prepared the application's actual
isolated frame. Its exact HTML was rendered with Chromium's page-scoped PDF API:
an eight-subject report yielded one nonblank A4 page; a 65-subject report yielded
three nonblank pages with every subject and repeated headers. PDF text extraction
and raster inspection confirmed content, own-school colors, logo and selected
child's synthetic photo. Fixture application API calls were intercepted; no
existing child records or application data were written.

This establishes the browser/PDF rendering path, not physical Android print
services or an OS Save-as-PDF dialog. Native printing was intercepted in the
automated browser to retain the prepared document for inspection.
