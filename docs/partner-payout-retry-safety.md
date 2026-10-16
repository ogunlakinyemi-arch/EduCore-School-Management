# Partner payout retry safety

## Reference and scope

The Replit checkout was clean and exactly matched GitHub origin/main at
`4f8dde2a78114d27e1d701ffc14d773b45f8fbbere` before these changes.
GitHub was fetched for comparison; nothing was pushed.

## Contract

POST /api/platform/partner-payouts now requires a client-generated
`idempotencyKey` in its JSON body (8–100 ASCII letters, digits, hyphens or
underscores; UUIDs are suitable). It is platform-wide, not scoped to the
requesting Owner: all access and replays still require PLATFORM_OWNER.

The request fingerprint includes Partner, exact two-decimal amount, currency,
periodStart, periodEnd, method and notes. Equivalent amount representations and
currency case normalize; omitted/default server dates are not recalculated as
part of a retry's fingerprint. Unknown request fields fail validation.

The same key and normalized payload return the original 201 creation response,
including original timestamps, even after the payout changes state. A changed
payload returns 409. This is not a status lookup; use the payout list for current
status. Replays do not reserve more commissions or duplicate the creation audit.
New intended payouts always need new keys. Requests created before this feature
have no stored retry identity and must not be reconstructed or auto-retried.

The handler acquires a transaction-scoped advisory lock for the request key,
checks stored identity, locks PAYABLE unassigned commissions in existing order,
creates the payout, reserves an exact whole-entry subset, writes the audit and
stores a response snapshot, then commits. The key table has a primary key and
one-to-one payout constraint. Any error before commit rolls back every effect.
No request identity is expired or automatically deleted.

The Owner UI saves the key and exact submitted draft in actor-scoped
sessionStorage before sending. Unknown/5xx outcomes retain the draft across
remount/reload in the same tab; inputs stay locked to that request. Confirmed
400/409 rollback responses allow correction, except key/payload conflicts, which
remain locked for review. Storage failure prevents sending. Closing/clearing
the tab's storage is not a substitute for reconciling an uncertain payout.

## Manual reference policy

The current manual workflow associates one payment reference with one payout;
there is no grouped/batch-reference contract. A unique partial expression index
on btrim(payment_reference) reserves each nonblank reference globally across
payouts, including different Partners. Matching is case-sensitive; there is no
provider guarantee that references are case-insensitive.

Once recorded, a reference cannot be replaced by this API, and FAILED/REVERSED
payouts retain it. Reversal references remain separate and do not overwrite the
original payment reference. Concurrent duplicate references return 409 without
changing payout, commission or audit state. These are manual bookkeeping
references, not verified bank delivery or reversal evidence.

Before adopting this policy on a populated target, review any established
off-platform batch-payment practice. If one bank reference legitimately covers
several payouts, implement an explicitly authorized batch-payment model instead
of removing uniqueness or rewriting historical references.

## Migration and rollout boundary

`lib/db/drizzle/0166_partner_payout_retry_identity.sql` is a new forward migration:
it creates partner_payout_requests and the manual-reference unique index in one
transaction. It does not backfill identities, change billing FKs, rewrite data or
alter migration ledgers. Duplicate legacy trimmed references intentionally make
the migration fail atomically. Resolve policy and historical evidence with an
operator; never silently delete/renumber payments.

The existing journal is behind the checked-in reconciliation migration set.
This migration is not appended to that journal, and no historical entries were
changed. Do not run the old journal wholesale or mark unapplied migrations
applied. Integrate this migration into the project's reviewed reconciliation
execution path after inspecting the actual target schema and ledger.

No migration was applied to shared Development or Production. The feature
requires the new schema before the updated payout routes are used in either
environment. Do not publish application code ahead of the schema.

Validation uses a newly created local PostgreSQL cluster with no TCP listener,
explicit synthetic credentials and private temporary socket. It uses a
legacy-shaped fixture for the relevant tables and executes the actual migration
file and HTTP handlers with synthetic authentication but real authorization
helpers. This is not a full historical database replay or current-target upgrade
certification. No shared application database or provider is contacted.

## Student subscription delete-action drift — deliberately unchanged

Affected FKs:

- student_subscription_payments_subscription_owner_fk
- student_subscription_allocations_attribution_partner_fk

Current ORM source in student-subscription-billing.ts omits onDelete and
therefore represents NO ACTION. Original migration 0036 and the saved canonical
catalog use ON DELETE RESTRICT, ON UPDATE NO ACTION.

The intended preservation-oriented resolution is to retain historical RESTRICT,
and explicitly align the ORM to it only after verifying the current Development
and intended Production definitions. If an actual target differs, review that
change separately and rehearse its DDL. Do not drop/recreate an FK blindly or use
this payout migration to change delete semantics. Neither RESTRICT nor NO ACTION
should be changed to CASCADE or SET NULL for this work.

No billing FK declarations, original migrations, or live FKs were changed here.
