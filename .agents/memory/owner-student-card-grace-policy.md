---
name: Owner student card grace policy
description: Owner-only administrative locks and temporary student/card payment pardons, without settlement or safety overrides.
---

The Platform Owner may explicitly lock or unlock an administrative card lock and grant or revoke temporary grace for selected eligible student payment restrictions. Every action requires confirmation and a mandatory reason, retaining the original state and full actor/time/student/UID/scope history.

**Why:** On 2026-11-02 the user requested Lock, Unlock and temporary pardon/grace controls on Owner student NFC management screens, not on any other role's screens.

Grace is access permission, never payment evidence, financial settlement, a fee waiver, permanent activation or removal of a card lock. Keep initial staged activation and replacement payment requirements strict. Scope temporary permission to the exact school, student, physical UID, assignment and current academic term; do not carry it into another assignment or term. It ends at its explicit expiry or an audited early revocation.

**Why:** The user specifically prohibited financial ledger/history changes and bypasses of genuine security, lost/stolen/replaced/expired cards, invalid identity, school/device authorization, reader requirements and other safety restrictions.

**How to apply:** Treat unknown or unavailable payment evidence as non-overridable. Evaluate normal eligibility at attendance-decision time, not a backdated scan timestamp or a scheduler's last run. Preserve independent school/security locks, clearly explain the permitted resolution workflow, and distinguish Owner administrative locks from legacy/security locks. Display local expiry time with an explicit timezone and retain its absolute instant. Development implementation and isolated tests do not authorize real card changes, Production writes, credential/device changes or publishing.
