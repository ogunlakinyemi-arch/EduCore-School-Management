---
name: EduCore extension requirements
description: Owner-defined curriculum provenance, lesson-note history, and existing-user activation boundaries.
---

Extend the existing system rather than replacing its registration, authentication, transport, notification, audit, or academic workflows. Preserve the School Admin User/Permission Role section; activation selects an existing school person and retrieves their details instead of requiring re-entry or creating duplicates. Adding a child to an already active parent must reuse that parent's account and authorized relationships without another activation invitation.

**Why:** The owner explicitly requires these boundaries in the master development prompt and repeatedly emphasizes preserving the existing workflows.

**How to apply:** Inspect and reuse existing services and authorization before adding capabilities. Treat a redesign or duplicate workflow as outside the requested extension.

Use a centralized, versioned curriculum library with authoritative source references. Never fabricate official curriculum or represent school additions, EduCore sequencing suggestions, or AI assistance as government curriculum. Where automatic retrieval is unreliable, support owner-uploaded official documents, extraction review, corrections and publication. Class/subject applicability must be configurable.

**Why:** Schools should not manually type the national syllabus, and the owner requires clear provenance, particularly for applicable NERDC materials.

**How to apply:** Keep official content and school-specific additions distinguishable, retain source and verification metadata, and label any optional generated lesson content as an AI draft requiring teacher review.

Preserve curriculum versions associated with historical records and retain each lesson note's original curriculum version. Creating a lesson note must not mark a topic completed; progress requires a separate appropriate approval or teaching-progress action. Lesson-note drafts and review discussions are private to the authorized teacher/admin workflow, not parent/student views.

**Why:** The owner requires reliable academic history and distinguishes preparation, review, and actual teaching progress.

**How to apply:** Use versioning and archival rather than overwriting history, enforce assignment and tenant authorization on the server, and keep lesson-note workflow separate from topic completion.