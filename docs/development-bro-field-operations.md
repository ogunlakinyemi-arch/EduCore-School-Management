# BRO Field Operations & School Lead Management — Development MVP

- BRO: `/partner/field-operations`; Owner: `/partners/field-operations`.
- API: `/api/bro-field/*`. Server requires Development, non-deployment runtime,
  an authenticated active BRO profile/membership or active Platform Owner.
- Each BRO user owns their records individually, not their whole BRO team.
  Owner oversight is read-only for visit fields.
- Record updates append visit snapshots to the existing audit log. Original
  ownership, claim aliases, transfer decisions and field-operation audit records
  are retained. Editing identity fields does not release previous claim aliases.
- Conservative duplicate warnings compare normalized school name, phone or
  address against lead claims and the school registry. Aliases and school links
  have unique claims, with transactional serialization and version checks.
- Transfers/releases are requested, then explicitly approved or rejected by the
  Owner with a reason. Pending requests cannot change ownership. A stale request
  must be rejected and replaced; inactivity never releases a lead.
- Adopted requires a matching existing school reference. A different BRO's
  registered-school association cannot be claimed. An already linked lead keeps
  its school reference after a field-operation transfer. No referral,
  attribution, commission, school creation or financial data is changed.
- Follow-up dates are visibility/filtering only. No scheduling, reminders,
  outreach, notifications or attachments were added.

## Development migration

`lib/db/dev-reconciliation/bro-field-operations.sql` creates three scoped tables
(`bro_field_leads`, `bro_field_claims`, `bro_field_transfers`) and preservation
triggers, including a trigger restricted to `BROFieldOperations` audit records.

Validated on a disposable local PostgreSQL cluster, then explicitly applied only
to the verified Development target after the application's connection and the
Development database tool reported the same connection fingerprint. No
Production query, migration, deployment hook or startup-time schema write was
added. This is an explicit Development reconciliation file, not a Production
migration or a new publish prerequisite. Do not apply it to Production without
separate authorization and review. Do not drop tables to undo it after records
exist; ownership and audit history must be retained.

Focused tests: `artifacts/api-server/src/routes/bro-field-operations.postgres.test.ts`.
They use an isolated cluster, synthetic users and loopback HTTP only.
