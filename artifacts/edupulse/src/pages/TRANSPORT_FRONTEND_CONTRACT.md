# Transport frontend: fields needed from the final codegen

The frontend will wire these only from generated hooks and types. Nothing here is hand-typed.

## Observed in the backend routes but NOT yet in generated client (as of this check)
- `GET/POST /transport/routes/:routeId/staff`, `PATCH .../staff/:routeStaffId` (accompaniment).
  Body: `{ employeeId, role: TEACHER | STAFF | ACCOMPANIER }`, patch `{ isActive }`.
  Rows: `routeStaffId, schoolId, routeId, employeeId, role, isActive`, plus employee name and number.
- `GET /transport/routes/:routeId/history`
- `GET/PATCH /transport/policy` with `{ paymentRequired, suspendWhenOverdue }`
- `POST /transport/finance/terms/:termId/generate`
- `POST /parent/children/:studentId/transport/requests/:requestId/withdraw`
- `accompanyingStaffCount` on routes.

## Still missing in the backend contract
- Assignment create and update currently accept only `studentId, routeId, pickupStopId, dropoffStopId, effectiveDate, reason`. No fee plan, academic term or due date is accepted.
- Route has `fareMinor` only. There is no `defaultRouteFare` yet.
- A selector for existing Teacher and Staff employees (route staff endpoint) and for existing fee plans, current term and due date records.

## Needed after codegen
- Hook names and param types for all of the above.
- The fee plan field on `TransportAssignmentInput`, and whether it is a fee structure id or a fee category id.
- Whether the term and due date come from the plan or the request.
- Where the existing selectors are served from: `useListFeeStructures`, `useListAcademicTerms` and `useListEmployees` are already generated.
