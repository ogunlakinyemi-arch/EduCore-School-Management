---
name: Existing CHECK differences in Publish
description: A same-name CHECK expression change can be omitted from the actual Publish preview.
---

Do not assume Publish will emit a changed CHECK expression when Development
and Production use the same constraint name.

**Why:** A Development CHECK permitted additional valid lifecycle values, but
the actual Publish preview omitted the existing-name expression difference.
Making the desired replacement a distinctly named CHECK in both authoritative
schema source and Development caused the preview to include the old CHECK
removal and the desired CHECK installation.

**How to apply:** Inspect the actual fresh preview after changing an existing
CHECK. If an expression difference is omitted, use a semantic replacement name
and confirm both operations appear, with all retained values supported.
Distinguish removing an obsolete CHECK from deleting data, but disclose any
compatibility warning. Do not rename equivalent UNIQUE keys for cosmetics or
use Production hooks or ledger edits as a workaround.