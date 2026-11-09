# Recent Development features — prepared Production release

Status: **PREPARED, NOT DEPLOYED. Production execution remains blocked pending
operator verification of the serving writable primary.**

## Approved scope and code

- BRO Field Operations, existing PARTNER/BRO and PLATFORM_OWNER permissions,
  exclusive claims, original ownership and audited Owner-approved transfers.
- Teacher period In-app/push alerts, five minutes before start and at period end,
  using existing timetable/assignment, school timezone and deduplication checks.
- Teacher Telegram linking, private-chat verification, explicit confirmation and
  consent, withdrawal, cross-account uniqueness and current-period Telegram alerts.
- Platform Owner notification-only delivery controls and directly related
  recipient, teacher dispatch and Telegram-link validation fixes.

The feature-specific runtime gate now permits normal Production as well as
Development. Its historical internal helper name is retained to minimize changes.
Invalid Development-with-deployment-flag combinations remain denied. No global
environment flag, authentication, role/tenant boundary, financial job, notification
cutoff, recipient selection or consent requirement is bypassed.

Production Owner approval uses `PRODUCTION_DELIVERY_CONTROLS_UPDATED`; existing
Development approvals retain `DEVELOPMENT_DELIVERY_CONTROLS_UPDATED` and cannot
activate Production. Missing or malformed Production controls yield:

```
paused=true
smsEnabled=false
pushEnabled=false
telegramEnabled=false
pushParentIds=[]
activatedAt=null
```

No approval record is inserted by code startup or either migration. Scheduler and
delivery polls may inspect paused state, but do not queue teacher reminders or
claim/send provider work while paused. General/payment worker pauses and the
Development payment-test safeguards remain unchanged. Publishing never constitutes
delivery activation. Telegram bot/provider readiness and its existing Production
opt-in, browser push registration, current event selections and consent remain
independent prerequisites; no setting is changed by this package.

## Reviewed SQL artifacts and dependencies

Run only through an authorized operator's supported Production console/platform
path on the **verified serving writable primary**, not Agent's replica.
No automatic startup/build hook or custom Production runner was added.

1. `lib/db/reviewed-releases/recent-features-preflight.sql` — read-only checks.
2. `lib/db/reviewed-releases/bro-field-protections.sql` — only the four original
   BRO protection functions and four triggers on the three existing BRO tables
   and existing audit table. No BRO table creation or row copying.
3. `lib/db/reviewed-releases/teacher-telegram-production.sql` — the two teacher
   tables (only if absent), consent/expiry checks, keys, serial ID sequence and
   unique indexes; the chat-exclusivity function and its parent/teacher triggers.
4. `lib/db/reviewed-releases/recent-features-postflight.sql` — read-only definition,
   binding, constraint, index and paused-control checks.

BRO and teacher SQL are independent of one another. Within the teacher transaction,
existing users/schools/parents/parent Telegram storage must precede teacher tables;
teacher tables precede the exclusivity function, which precedes both triggers.
All protections must be installed and verified **before exposing the new code**.

Both installation artifacts are single transactions with bounded lock/statement
timeouts. Matching existing objects remain in place on repetition. Unexpected
definitions or disabled/misbound triggers abort, rather than being overwritten.
Teacher SQL validates existing table columns, constraints, defaults and indexes.
It does not recreate populated tables or update parent profiles/links/challenges.
If tables were already created by Publish, the same artifact validates them and
installs the missing procedural protections. Cosmetic CHECK-definition differences
also fail closed and require explicit review; do not loosen them automatically.

The teacher artifact is intended for the documented operator console path, not
Agent execution against managed Production. If the console/platform cannot apply
the reviewed transaction, stop and obtain the supported platform-assisted path.
Do not substitute a connection secret, startup DDL, or deployment build hook.

## Primary and recovery gate — exact remaining operator work

Previously observed Agent Production SQL was `neondb`, recovery mode `true`,
transaction read-only `on`. This is not a writable-primary execution path.
Deployment metadata did not expose its database binding. The app consumes its
runtime `DATABASE_URL`, so database name alone is insufficient identity evidence.

The inspected 2026-11-09 screenshots establish Production Database UI recovery
configuration: seven-day PITR, seven-day scheduled backup retention and a backup
reported 14 hours old at capture. These confirmations are acknowledged; do not ask
for the same screenshots again. They do not grant Agent write access or prove a
tested restoration.

The authorized operator must:

1. Correlate the **serving deployment's configured database resource** with the
   selected Production Database. Inspect privately; do not paste credentials.
2. Confirm Production console/operator permission to create functions/triggers
   and the two authorized teacher tables/indexes. Run preflight there. Require
   `is_replica=false`, `read_only=off`; inspect unexpected objects before changes.
3. Confirm recovery access and an appropriate available recovery point for that
   same resource, plus the restore procedure and acceptable recovery interval.
4. Execute each reviewed installation SQL as **one complete batch on one session**.
   Never split a transaction across independently pooled tool calls.
5. Run postflight on the same primary. Require five approved function definitions,
   six enabled (`O`) triggers on their exact tables, all teacher constraints and
   indexes, and paused/off/empty Production controls. An existing active Production
   approval must be reviewed; do not silently overwrite it or proceed under an
   assumption that default state applies.
6. Only after these checks, review the final Publish plan and click Publish.
   Publishing is user/operator initiated; Agent has not published this package.

## Structural Publish preview and scope boundary

This preparation did **not access Production**, including the preview callback,
because that would read Production. The last inspected preview contained exactly
eight authorized statements:

- create `teacher_telegram_links` and `teacher_telegram_challenges`, with their
  primary keys, consent/expiry checks and challenge serial sequence;
- add their four user/school foreign keys;
- create `teacher_telegram_chat_unique` and `teacher_telegram_token_unique`.

It contained no drops/truncations, unrelated tables or structural data-loss
warnings. This preparation makes no changes to the Drizzle schema source; the
new review SQL is not wired into any auto-migration or deployment hook.

A **fresh Production-backed preview is an operator release gate**, not a result
claimed for this turn. If the operator installed the complete teacher artifact
first, expect no remaining structural difference for these features. Otherwise
the expected structural list is the eight statements above. Reject unrelated
changes or unexplained CHECK replacements. Functions/triggers are not covered by
Replit's automatic structural preview; postflight plus the two reviewed SQL
artifacts form the separate procedural part of the complete release review.

The code manifest is limited to the approved feature gates, Production-separated
Owner audit controls and corresponding UI text/tests. Existing unrelated
Development-only features (such as legacy BRO commission actions, LIVE-readiness
tools and sandbox NFC controls) are not enabled by this package. A clean Git
status or an empty table diff does not certify an arbitrary repository feature
as complete.

## Non-destructive verification after operator publication

Keep delivery paused, channels off and recipients empty. Verify:

- signed-in BRO desktop/mobile navigation, own leads and cross-BRO denial;
- Owner oversight and existing-record read access, with transfer mutations left
  to disposable fixture evidence rather than moving real leads for a test;
- teacher Preferences/linking availability under the teacher's own school/role;
- Owner-only controls, defaults and denial for BRO/school/family roles;
- unchanged parent linking/profile data and retained financial/audit history.

Do not enable channels, select recipients, resume delivery or send a test message.
Real browser/provider receipt verification remains separate from code/SQL evidence.

## Rollback and recovery

- A failed installation rolls its own transaction back. Stop on lock timeout,
  shape drift or primary/recovery uncertainty; do not partially apply or retry
  blindly. BRO and teacher transactions are independent; if the second fails,
  retain the first's valid protections while investigating.
- If code rollout fails, keep delivery paused and restore the prior application
  release using the supported operator release process. Retain additive tables,
  functions/triggers and all data; do not remove protections or drop tables as
  an automatic rollback.
- Once any teacher link/consent/history exists, destructive schema rollback is
  not authorized. Parent exclusivity depends on teacher storage: never drop a
  teacher table while leaving a parent trigger that references it.
- Database/PITR restoration is a separately reviewed recovery action against the
  verified resource. It can discard newer legitimate records; establish impact
  and authorization before executing it. No restore was attempted here.

Official platform references:

- https://docs.replit.com/features/data-and-storage/work-with-your-data
- https://docs.replit.com/features/data-and-storage/publish-database-changes
