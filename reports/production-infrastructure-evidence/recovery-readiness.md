# Production PITR and recovery readiness

**RECOVERY PROTECTION UNVERIFIED**

Checked: 2026-10-07T08:38:29.806Z

## Identified resource
- Resource ID: **ep-proud-sound-b4nsr0y3**
- Database: **neondb**
- Provider: **PostgreSQL / Neon**
- Environment: **Production**
- Designation: **Primary**
- Used by: **Active Production deployment**, as supplied by the user from the Replit interface.

This identification is accepted as the scope of this recovery review. It is not an independently retrieved deployment/resource binding. No broad target verification or schema audit was repeated.

## Recovery evidence
| Recovery item | Result |
|---|---|
| Production resource | ep-proud-sound-b4nsr0y3 |
| PITR enabled | UNKNOWN — resource-specific status unavailable |
| Recovery window | UNKNOWN — actual retention/window unavailable |
| Earliest recovery point | UNKNOWN — timestamp/timezone unavailable |
| Latest recovery point | UNKNOWN — timestamp/timezone unavailable |
| Latest successful backup | UNKNOWN — timestamp/status unavailable |
| Automated backups | UNKNOWN — enablement, schedule/frequency and run status unavailable |
| Recovery point available | UNKNOWN — no resource-bound inventory exposed |
| Resource health | UNKNOWN — no primary-specific health/status exposed |
| Adequate for migration | UNVERIFIED |
| Production writes | 0 |

Unknown does not mean disabled, unhealthy or no backups exist. No such negative inference was made.

## Available supported metadata
- Fresh integration inventory returned Neon MCP with status **not_setup**. No existing authorized Neon connection was available to read this resource’s recovery metadata. No integration was connected or proposed.
- Existence-only Production/shared checks found no NEON_API_KEY, NEON_API_TOKEN or REPLIT_API_KEY under those names. No secret values were accessed or requested. These limited checks do not rule out every credential/configuration elsewhere.
- Fresh supported deployment metadata confirms a public Autoscale deployment and successful build. It contains no resource-bound backup/recovery-point inventory or primary health. Build success is not database health or recoverability evidence.
- Official Replit documentation identifies the Database Settings/Recovery and Monitoring surfaces for operator inspection. No resource-specific contents of those surfaces were exposed by the available authenticated metadata interfaces.

## Adequacy for the planned operation
The operation is **105 forward migrations in five controlled batches**. No actual resource-bound recovery evidence supporting a positive adequacy assessment was available. In particular, the latest usable pre-operation recovery point, recoverable interval, successful backup status and current primary health are unknown. Therefore this gate is **not cleared**.

Documented PITR capability or a previous/default seven-day window does not establish actual coverage, usable points or adequate recovery objectives. Daily scheduled-backup capability does not demonstrate enablement or a successful point for this resource. No restoration test, snapshot creation or settings change was performed.

## Primary versus Agent read route
The supplied interface designation is **Primary** at resource level. The previous Agent read-only query returned neondb with pg_is_in_recovery()=true, transaction_read_only=on and default_transaction_read_only=off. Those observations describe the reached backend/session, not the identified Primary resource’s recovery policy.

**The relationship between ep-proud-sound-b4nsr0y3 and the Agent standby read route remains UNVERIFIED.** No supported metadata mapping was available. No query was repeated and no test write attempted during this recovery review.

## Exact unavailable evidence / remaining requirements
- Resource-specific PITR enabled/disabled
- Earliest recoverable timestamp with timezone
- Latest recoverable timestamp with timezone
- Configured retention and actual recoverable window
- Latest successful backup timestamp/status and inventory
- Automated backup enablement and actual schedule/frequency
- Usable recoverable restore-point availability
- Current authoritative primary resource health
- Resource mapping between Primary and Agent standby read route
- Operation-adequate recovery protection for 105 forward migrations/five batches

Required: non-secret read-only Settings/Recovery/Monitoring or authorized provider metadata tied to the identified resource, showing actual status/timestamps/window, successful points and backup scheduling/status, with evidence supporting the operation’s recovery objectives. Inspect existing information only; do not enable backups, create snapshots or restore.

## Sources and preservation
- User-supplied current Replit resource information.
- Fresh supported integration inventory, existence-only secret metadata and getDeploymentInfo.
- Fresh official Replit documentation lookup; https://docs.replit.com/features/data-and-storage/data-recovery.
- Reused reports/production-infrastructure-evidence/recovery-evidence.json and earlier Production standby evidence, scope preserved.

**Production writes: 0. Development writes: 0.** No SQL queries or connections this review; no migrations/0060, schema/data/sequence changes, PITR/settings changes, backup scheduling, snapshots, restores, journal changes, deployment or secret changes. Only recovery-readiness.md/json were created. Existing reports and application configuration were preserved. No migration or Batch 1 approval.
