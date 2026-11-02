---
name: Owner student card grace policy
description: Owner-only administrative locks and temporary student/card payment pardons, without settlement or safety overrides.
---

The Platform Owner may explicitly lock or unlock an administrative card lock and grant or revoke temporary grace for selected eligible student payment restrictions. Every action requires confirmation and a mandatory reason, retaining the original state and full actor/time/student/UID/scope history.

**Why:** On 2026-11-02 the user requested Lock, Unlock and temporary pardon/grace controls on Owner student NFC management screens, not on any other role's screens.

Grace is access permission, never payment evidence, financial settlement, a fee waiver, permanent activation or removal of a card lock. Apply initial activation and replacement subscription payment requirements only in chargeable terms under the central January 2027 rollout policy; all current pre-subscription-term activations are free. Scope temporary permission to the exact school, student, physical UID, assignment and current academic term; do not carry it into another assignment or term. It ends at its explicit expiry or an audited early revocation.

**Why:** The user specifically prohibited financial ledger/history changes and bypasses of genuine security, lost/stolen/replaced/expired cards, invalid identity, school/device authorization, reader requirements and other safety restrictions.

**How to apply:** Treat unknown or unavailable payment evidence as non-overridable. Evaluate normal eligibility at attendance-decision time, not a backdated scan timestamp or a scheduler's last run. Preserve independent school/security locks, clearly explain the permitted resolution workflow, and distinguish Owner administrative locks from legacy/security locks. Display local expiry time with an explicit timezone and retain its absolute instant. Development implementation and isolated tests do not authorize real card changes, Production writes, credential/device changes or publishing.

For active/security/administratively locked cards, show management actions with disabled reasons when unavailable and Revoke for active grace. For awaiting initial activation, show a simple Activate card action instead of administrative Unlock or Grace controls; label it free when central policy says payment is not required.

**Why:** The user reported “Nothing is there” when every action was filtered out on an awaiting-activation card. Missing controls concealed the difference between policy denial and a broken panel.

**How to apply:** Keep a visible Actions section ahead of verbose restrictions/history. Show precise policy reasons without weakening server-side permissions. Initial activation is not administrative Unlock. The later clarification that all pre-subscription-term activations are free supersedes the earlier assumption that initial activation always requires payment.
