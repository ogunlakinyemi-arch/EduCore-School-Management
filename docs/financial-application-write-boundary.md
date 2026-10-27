# Option A: application financial protections

## Scope and release status

The Owner selected application-level consolidation, not a new financial data
model. No schema, prices, financial history, credentials or LIVE switches are
changed. This work does not install migration 0179 or replace its database guards.

The existing direct and BRO readiness checks still require their exact approved
PostgreSQL functions/triggers. Their absence remains blocking. Public direct
callback/webhook verification also checks the direct schema contract before any
provider GET or financial update. This change does **not** make the feature
Publish-ready where the required procedural objects are missing.

## Application write contract

`services/financial-history-writes.ts` is the shared boundary for SQL mutations of:

- Direct reviews, release requests, decisions and bindings.
- Direct obligations, attempts and events.
- Independent BRO term commission entitlements.

Only named INSERT operations exist for history. There is no history UPDATE,
DELETE, generic SQL, dynamic table or dynamic column operation.
Attempt creation always starts at RESERVED. Attempt updates take a row lock,
reject caller-supplied identity columns, preserve the originally observed
transaction ID, reject terminal updates (including no-ops), and condition the
UPDATE on the observed nonterminal state.

Permitted transitions:

| From | To |
| --- | --- |
| RESERVED | READY, UNKNOWN, PENDING, PAID, FAILED |
| READY or UNKNOWN | PENDING, PAID, FAILED |
| PENDING | PAID, FAILED |
| PAID or FAILED | None |

Provider duplicate delivery is handled **above** that boundary: the verification
service checks matching transaction/outcome and returns the frozen terminal row
without updating it. Repeated pending observations similarly avoid another event.
The provider transport, not caller claims, establishes financial facts.

Callers retain ownership of their existing transaction and must pass its pinned
client to the boundary. State, event and audit writes must commit together.
Checkout claims remain committed before a provider POST; an uncertain POST is
never automatically retried. A verified zero-charge failure permits a new attempt,
not mutation of the failed attempt.

Release review, checkout and BRO services recheck active database-backed actor
authority before writing. School Admin checkout excludes Owner identities;
Owner assistance retains independently verified bank-credit requirements.
Public callback/webhook finalization intentionally does not require a signed-in
actor: it requires the existing configuration/authentication rules and independent
provider verification.

BRO accrual retains its policy/scope locks, participant eligibility, January-term
rollout, latest approved policy, historical commission exclusion, exact student/
term verified payment and one-earning uniqueness. The boundary repeats 0179's
cross-table earning predicate before INSERT with shared row locks. Verification
timestamps are passed using PostgreSQL's exact text, not a millisecond-rounded
JavaScript Date. Entitlements remain separate platform expenses; existing ₦100
history is untouched. An entitlement does not authorize a payout.

## Entry points

- School Admin checkout and Owner-assisted checkout use `startDirectStudentPayment`.
- Public callback and authenticated raw-body webhook use `verifyDirectStudentPayment`.
- Owner release-review creation and decisions use the release service.
- Owner BRO accrual uses `accrueBroCommission`.
- Access/enforcement consumers continue reading the same financial tables.

The source regression test rejects protected literal SQL mutations elsewhere in
application TypeScript. This is a maintenance check, not a SQL firewall; dynamic
SQL, scripts and externally issued SQL are outside its guarantee.

## Residual limitations: not equivalent database enforcement

Application code cannot guarantee these invariants against privileged/direct SQL
writers using the shared database credentials:

1. History cannot be edited/deleted; attempt identity and terminal evidence
   cannot be changed.
2. Every BRO INSERT meets the cross-table earning predicate.
3. All inserted payment/approval evidence originated in an authorized application
   flow or real provider verification.
4. Every future writer follows the same locks, transaction and authorization
   protocol.

No triggers, permissions, RLS, tables or constraints are removed or weakened.
Existing database guards remain independently useful where present. The existing
row triggers themselves do not protect TRUNCATE or privileged DDL.

This is application-path consolidation, **not** proof of all-writer equivalence,
supported procedural delivery, production readiness or real settlement.
The unresolved Publish delivery issue and all other LIVE release prerequisites
must remain blocked until separately resolved and explicitly authorized.

## Verification boundary

Focused unit tests cover transition combinations, identity immutability, terminal
no-ops, missing payment facts, authorization, invalid history mutations and the
centralized SQL rule. Credential-free disposable PostgreSQL tests cover real row
locking, concurrent finalization, callback/webhook replay, lost checkout responses,
zero-charge retries, exact-scope access and transaction rollback. Separate BRO
fixtures cover concurrent earning, legacy preservation, eligibility and audit
failure. These fixtures do not establish Production catalog state, deployment
compatibility, actual bank credit or Flutterwave delivery/settlement.
