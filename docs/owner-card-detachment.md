# Ordinary Owner card unlink

The existing `POST /api/platform/uid-inventory/cards/:cardId/unlink` lifecycle now
accepts a separate `kind: "DETACH"` action. Its confirmed request requires
`schoolId`, `personType` (STUDENT/TEACHER/STAFF), `personId`, and a trimmed 3–480
character reason. Existing LOST/DAMAGED requests and replacement billing behavior
are unchanged.

This is a Development implementation, not authorization to unlink any shared or
Production record. No schema migration, device reconfiguration or credential
operation is needed.

## Confirmation and authorization

The existing-person link panel offers **Unlink Card** only when the authorized
context is Platform Owner and the selected person has a current active/locked
card. Its confirmation identifies the UID/person, explains detachment and
preserved inventory/history, and states that no lost/damaged report, replacement
or charge will be created. Reason choices are Reassignment, Returned card,
Correction and Other; Other requires details. Cancellation makes no request.

The server independently enforces Owner authorization, confirmation, reason,
school and exact selected-person association. A changed, missing, already
unlinked, lost or retired card is rejected. Student and employee associations
cannot be confused by changing personType in the request.

## Transaction and history

Detachment, append-only person/card history and `OWNER_CARD_DETACHED` audit are
one transaction. An audit failure rolls everything back. Row locks serialize
competing confirmations. Inventory rows, UID, school, reader/device history,
scan counters and historical attendance records are not deleted or reset.

Student card ownership becomes null and the physical card becomes `unassigned`.
Employee bindings become non-current using the existing binding status
`DEACTIVATED`; the **physical card** becomes `unassigned`, not inactive/lost.
Employee history records the previous person, binding and reason.

The existing schema has one mutable employee binding per physical card. A later
employee assignment can reuse that binding only when it is DEACTIVATED, its
latest history action is explicitly UNLINKED, and its school matches. Old
append-only employee history and event-time employee IDs remain unchanged.
An ordinary deactivation, loss or replacement does not qualify for this reuse.
Student/employee cross-purpose restrictions remain unchanged.

## Assignment after unlink

The existing link-to-person flow can assign the same available UID again under
its existing school, active-person, reader and duplicate-card rules. It returns
to locked provisioning, not automatic activation. Lost-card paid replacement
gates remain separate and cannot be bypassed through DETACH.

After success, card inventory, selected-person lists, current cards and employee
NFC queries are invalidated. The selected person remains selected, its summary
shows no linked card, stale printable-assignment state is removed, and the direct
unlink button disappears.

## Verification

Focused UI checks cover authorization/linked state, all three person types,
confirmation/cancellation, reason capture, errors and refresh invalidations.
Disposable PostgreSQL tests cover preserved inventory/history/attendance/device
references, audit metadata, mismatched scope, terminal statuses, concurrent
confirmation, same-UID assignment, employee binding reuse, and audit rollback.

Browser evidence uses the real component with intercepted synthetic API fixtures,
not a signed-in live account. No real unlink or account creation is part of the
browser check. The separate opt-in legacy replacement integration suite was
not run because its isolated fixture environment was not configured.
