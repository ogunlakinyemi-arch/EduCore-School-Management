---
name: NFC device-first policy
description: Assignment prerequisites, inherited school-reader access, and treatment of legacy cards without readers.
---
Student NFC assignment and future activation require an active linked NFC-capable reader at the student's school. Cards inherit access through the school, including readers linked later; do not introduce per-reader card assignments.

**Why:** The user explicitly requires Device → School → Card → Student, not a separate card setup for every reader. The new prerequisite must not silently expand existing activation privileges.

**How to apply:** Keep backend enforcement on every Student assignment and activation path, alongside the Owner-only controls. A newly assigned prepared card retains staged activation rather than becoming automatically unlocked.

Preserve legacy assignments even when their school lacks eligible readers. Identify current versus historical rows separately and direct the Owner to the existing device-linking workflow; never delete or recreate cards, assignments, or attendance to satisfy the new prerequisite.

**Why:** The user explicitly requires preservation of existing IDs and history and applies the prerequisite to new assignments and future activation, not destructive retroactive cleanup.

**How to apply:** Do not add a uniqueness migration that would require deleting legacy duplicate locked assignments. Serialize new assignments and preserve historical device-school bindings when readers move.
