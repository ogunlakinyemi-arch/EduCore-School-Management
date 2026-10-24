# Same-email Partner reapplication

An archived test Partner may explicitly apply again with the same verified email.
This creates a **different internal EduCore account and pending application**.
The original account stays blocked until a separate Platform Owner restoration.
Neither email reuse nor approval of the new application emits a RESTORE event.

## User flow

1. The archived-access screen links to **Apply again as a Partner** at `/apply`.
2. Sign out and sign in again using the existing Clerk identity and verified
   primary email. Do not create a second Clerk identity for the same email.
3. Explicitly submit the blank Partner-only form. It does not automatically copy
   an old draft, name, business, school selection, role or invitation claim.
4. A fresh pending application appears. No operational role/profile is assigned
   before Owner approval.
5. Approval creates a new Partner profile, new profile membership and only the
   new account's PARTNER role. It does not copy school attributions, referral
   links, invitations, balances, commissions, history, device/card ownership or
   any other old records.

The browser clears previous account query/portal state on the transition.
An uncertain submit response can be recovered by reloading; do not automatically
repeat the POST. An identical request from its initiating session recovers its
pending application rather than creating another. Changed or subsequent active
applications retain duplicate protection.

## Identity and session boundaries

- The old app-user row keeps its original Clerk subject. The provider identity
  is not deleted, duplicated, relinked or globally disabled.
- A new app-user has a new internal ID and a NULL legacy Clerk binding.
  `partner_account_reapplications` records its explicitly verified external
  subject; `partner_reapplication_sessions` binds sessions to that new account.
  Recorded previous IDs are provenance, **not grants or history ownership**.
- The initiating session must be active, belong to the verified Clerk subject,
  and have been created after the relevant active archive BLOCK timestamp.
  Refreshed JWT `iat` values do not turn old sessions into new ones.
- A later genuinely new session may resolve to the newest reapplication account.
  Older/unassociated sessions do not get upgraded by email and still hit the
  archived original account's denial. A mapped-but-revoked new account cannot
  fall back to the old account.
- The archive email reservation is bypassed only for a server-resolved, recorded
  fresh internal account. User-ID and school/Partner root blocks still apply.
  Generic same-email provisioning and old invitation/referral paths remain
  blocked. A fresh profile can also be archived/restored independently; matching
  email alone never combines the two accounts' association evidence.
- Owner restoration remains a separate operation. Restoring the old account does
  not change the new session associations or merge profiles. If an old/other
  account is active before the new pending application's approval, the duplicate
  conflict requires review instead of silently merging or granting access.

## Duplicate and transaction safeguards

Only explicitly revoked test Partner associations qualify. An inactive status
alone is insufficient. Any active account/application or unrelated roster,
company or Partner reservation still blocks reapplication. Primary email must
be verified and match the submitted email; School Admin reapplication and
client-supplied identity/role claims are rejected.

Provider reads finish before database locks. Creation is one local transaction,
serialized with archive operations and existing identity/application writes.
The new user, registry, session association, application and audit event commit
together or roll back together. The server never copies archived privileges.

## Schema prerequisite and execution boundary

Migration `lib/db/drizzle/0174_partner_account_reapplications.sql`:

- permits NULL **new** legacy Clerk bindings while retaining their uniqueness
  and leaving all original values untouched;
- creates the explicit account/session association tables;
- adds a Partner-only reapplication reference to applications;
- keeps the original email uniqueness rule for ordinary applications and the
  one-application-per-user rule; explicit reapplications are separately serialized
  and checked against active duplicates.

Apply this reviewed migration **transactionally**, in an independently verified,
approved target before enabling the feature. Missing association tables produce
an explicit unavailable response on submission; they do not bypass archive
denials. Existing ordinary authentication keeps its legacy behavior when the
schema is absent.

**The migration was applied only in a disposable local fixture.** No shared
database, Production connection, real Clerk identity, shared setting/secret or
published application was changed for this work. Do not use
`account-application-migration-check.mjs` for this rehearsal: that older utility
captures a Development schema. The dedicated script below needs no existing DB.

## Focused verification

```sh
# Fresh private PostgreSQL 16 cluster, Unix socket only, no inherited credentials.
# Applies the real application migrations and starts an isolated HTTP test server.
bash scripts/src/production-reset/reapplication-rehearsal.sh

pnpm --filter @workspace/edupulse exec vitest run \
  src/components/partner-reapplication.test.tsx src/pages/application-flow.test.tsx
pnpm --filter @workspace/api-server exec vitest run \
  src/middlewares/auth.test.ts src/routes/test-account-archive-access.test.ts \
  src/routes/partner-invitations.test.ts src/routes/school-invitations.test.ts
node --test scripts/src/production-reset/*.test.mjs
```

The PostgreSQL rehearsal verifies the target before DDL, checks populated
migration preservation and duplicate-migration refusal, and tests actual
application/session/approval SQL with mocked provider reads. It commits only
fictional data, then stops and removes its own cluster. It never dumps, queries
or modifies a shared database. Real Clerk/browser behavior was not exercised;
HTTP tests and React component tests cover the changed flows without live
identity changes.
