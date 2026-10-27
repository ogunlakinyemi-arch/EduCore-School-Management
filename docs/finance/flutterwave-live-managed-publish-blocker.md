# EduCore LIVE: protected SQL managed-Publish blocker

Reviewed: 2026-10-27. **Outcome: NO-GO for LIVE activation.**
This is a technical handoff, not a migration, approval record or claim that
Replit Support has been contacted.

## Reconciled work

- Existing protection task: preserve the exact protected SQL package through a
  supported release path; do not substitute the incomplete trigger-free design.
- Existing configuration task: LIVE mode, release version and webhook URL are
  already saved. The three LIVE secrets are present. Its earlier missing-secret
  and missing-mode notes are stale; the tasks remain incomplete, not running
  duplicate implementations.
- Merchant scope and genuine school/release approvals remain unresolved. No
  release manifest, authority review or business evidence was invented or seeded.

## Verified operational evidence

Production configuration was inspected without exposing secret values:

| Item | Result |
| --- | --- |
| `EDUCORE_FLUTTERWAVE_MODE` | Matches `LIVE` |
| `EDUCORE_FLUTTERWAVE_RELEASE` | Matches `SCV3_V1` |
| `FLUTTERWAVE_LIVE_WEBHOOK_URL` | Matches `https://educore.yetenia.com/api/webhooks/flutterwave/live/student-subscription` |
| `PUBLIC_APP_URL` | Matches the platform-reported production URL |
| LIVE secret/public keys and dedicated LIVE verifier | Present; values not inspected |
| `EDUCORE_FLUTTERWAVE_MERCHANT_SCOPE` | Missing |

The platform reports a public Autoscale deployment at
`https://educore.yetenia.com`. This does not attest its loaded code revision or
effective runtime database binding.

An unsigned POST containing only `{}` and no authentication/transaction identity
to the configured LIVE webhook returned **HTTP 503**, `processed:false`, and
`Flutterwave LIVE configuration is disabled, missing or mismatched`.
The route is reachable and refuses this request. This is NOT proof of valid
signature acceptance, dashboard registration, provider delivery or LIVE readiness.
Local source authenticates before receipt storage/provider verification; no
genuine provider event or payment request was submitted.

A minimal SELECT against Replit's Production read replica found these public
tables absent:

- `flutterwave_live_release_manifests`
- `flutterwave_live_authority_reviews`
- `flutterwave_live_school_configuration`

Consequently no approved merchant scope or school authority could be retrieved
through the actual runtime table names. This is a replica/schema observation,
not a new attestation of the application's writable-primary binding or proof
that an external approval document does not exist.

The most recently inspected Publish preview returned `hasDiff:false`, with
zero LIVE statements, zero LIVE function creations and zero LIVE trigger creations.
It was not a staged installation; this documentation-only pass did not generate
a different schema plan.

## Exact protected package

All files are under `lib/db/dev-reconciliation/`. Current SHA-256 values match
the reviewed installation runbook. Dependencies are in the order shown:

| Stage / forward filename | Functions | Triggers | SHA-256 |
| --- | ---: | ---: | --- |
| `flutterwave-live-webhook-inbox.up.sql` | 0 | 0 | `ab644e6a38bdd1d9d4ef63f52cd971a05153e777b65d730567dac1ed231f874d` |
| `flutterwave-live-finalization.up.sql` | 3 | 5 | `62f70bc39f92852fd8219b0da063fc2299f3530fd8a4356fe197049f40eb4b1a` |
| `flutterwave-live-workflow.up.sql` | 2 | 8 | `a7e83947d2338d762a1830814d68f2be470e19866c46be84a8bccfad08d3c67a` |
| `flutterwave-live-readiness.up.sql` | 0 | 1 | `88e4bfa3eae084e6072b33d77125f9dc17bc74d5445fea1b28458522d9991a8c` |
| `flutterwave-live-runtime.up.sql` | 1 | 3 | `27754570bba1743944516b4200c9ca5198754d5d19076917788b46b958d2b77c` |
| `flutterwave-live-school-onboarding.up.sql` | 3 | 3 | `6808b70544f2f417b7ce2e39195301ae29fbb6781194fb1d0f62b58b3acc53f3` |
| **Total** | **9** | **20** | No forward or rollback SQL changed |

The precise function/trigger responsibilities and unresolved permission design
are in `flutterwave-live-application-redesign.md` and
`flutterwave-live-permission-boundary-review.md`.

## Why no repository-supported integration was made

- `lib/db/package.json` routes both schema push commands to a refusal script.
- `scripts/post-merge.sh` installs dependencies and explicitly skips schema writes.
- The schema exporter is credential-free, audit-only and has no execution
  capability; its current source model does not emit these functions/triggers.
- API build/run commands do not install SQL. Adding a build/startup Production
  migration would bypass the managed release workflow and is prohibited.
- The six files are review drafts, not an active migration journal/import hook.
- The supported Publish preview inspects Development-to-Production structure;
  there is no verified custom-SQL import or ownership/ACL lifecycle for this
  package in the repository.
- A PostgreSQL permission prototype and a generic statement that custom roles
  migrate during infrastructure upgrades do not prove ordinary Publish,
  credential rotation or restore preserves the required security boundary.

This establishes a missing verified integration contract, not a claim that
PostgreSQL or Replit can never support these objects.

## Exact minimal Replit support escalation — not sent

> Please identify the supported managed-Publish procedure for EduCore's six
> reviewed SQL files listed here, preserving all nine functions, twenty security/
> history triggers, constraints, ownership and runtime permissions. The current
> Publish preview contains no LIVE objects; the three required approval tables
> are absent from the Production replica. We need either a supported custom-SQL
> extension to Development-to-Production schema release, or a sanctioned
> platform-operated installation with guaranteed retention on subsequent Publish.
> Please specify staging, dependency ordering, DDL ownership/runtime-role handling,
> grants after recreation, credential rotation and restore verification. We cannot
> use startup/build SQL, unsupported Production DDL or remove financial guards.

Attach this document and the exact reviewed SQL package/runbook through the
project's support channel. Do not attach connection strings, credentials, bank
records, raw provider payloads or private identity data.

Relevant official reference:
https://docs.replit.com/features/data-and-storage/development-and-production
describes applying Development structural changes at Publish; it does not itself
establish this protected custom-object/permission lifecycle.

## Acceptance gates and action owners

1. **Replit/platform owner:** supply the supported preservation procedure.
   Do not stage or publish until this is explicit.
2. **Authorized release operator:** revalidate the intended resource, available
   recovery baseline, privileges and exact package; review the actual generated
   plan, preserve existing data and all guards, and verify each committed stage.
   Prior Owner-reported target/recovery confirmations remain acknowledged; they
   are not a fresh primary connection or execution record in this pass.
3. **Release operator:** installation must leave release/authority/configuration
   approvals empty. Verify functions, triggers, ownership and permissions as well
   as tables/keys; no automatic approval seeds or destructive rollback.
4. **Owner/business approver:** supply the actual merchant scope, existing school
   and LIVE school-owned `RS_...` subaccount, fee-bearer `MERCHANT` evidence,
   ownership evidence, reviewed document SHA-256 commitments, real reviewer
   identity and unexpired review. Schema installation cannot manufacture these.
5. **Production operator:** verify effective runtime database binding, loaded
   revision and startup delivery controls before a supported Production restart.
   The Development workflow is not a Production restart control. Existing startup
   invokes Telegram and database-target verification before the general pause.
6. **Owner/release operator:** only after these gates, authorize supported rollout;
   independent transaction verification, amount/currency/merchant checks,
   allocation evidence and idempotent finalization remain mandatory.

No support contact, migration execution, approval DML, schema staging, publishing,
Production restart or provider charge is represented as completed by this handoff.

## Focused validation outcome

- **145 tests passed across five files:** payment mode, LIVE configuration,
  LIVE runtime, fee-provider adapters and LIVE webhook readiness. Tests use the
  repository's network-restricted harness and fictional/injected dependencies,
  not real provider transport.
- API TypeScript check: passed.
- API build: passed. Esbuild reported bundle-size warnings; no compile error.
  Build output does not mean the built revision was deployed or started.
- Static package check: all six forward hashes match this handoff and the
  reviewed installation runbook; nine unique functions and twenty unique
  triggers; all six rollback companions exist. No protected SQL/source changes.
- The three new handoff links resolve; whitespace/diff check passed.
- No database migration or permission/trigger execution rehearsal was performed.
  These checks do not establish Publish support or permission equivalence.
