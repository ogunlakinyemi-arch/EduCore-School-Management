# Next-term readiness: staged review, not release authorization

Review date: 2026-10-28. Status: **blocked for Production financial release**.

This review changed documentation only. It did not connect to Production,
inspect secrets, change application/SQL definitions, alter shared data, publish,
run a Production migration, provision an external service, or activate LIVE.
The PostgreSQL test below used a new credential-free local disposable cluster.

## 1. Owner dashboard: verification still outstanding

The retained independent browser was checked again. It remained at `/sign-in`;
there was no authenticated Development Platform Owner session. A sign-in
screenshot is not dashboard evidence. No Owner dashboard viewport measurements,
mobile/desktop screenshots, or selected-school navigation were obtained.

### Exact manual acceptance steps

Use an already-authorized Platform Owner account in the **Development preview**,
not the published site. Do not create accounts or change roles for this check.

1. Sign in through the normal supported login flow. Confirm the actual account
   has Platform Owner access; selecting a portal in the sign-in form grants none.
2. Open `/` and select the network/all-schools view in the header school selector.
   Confirm the heading “The whole network, at a glance.” is visible.
3. Set browser zoom to 100% and responsive viewport to **390 × 844 CSS pixels**.
   Scroll from top to bottom. Check the header controls, school selector,
   application panel, network metrics, allocation cards and activity panel.
   Text must remain readable, controls reachable and sections within the content
   width. An inner table may scroll; the page itself must not scroll sideways.
4. Open and close the mobile navigation normally. Confirm the menu, dismiss
   control and main content remain usable without forced clicks.
5. In the browser console, run this read-only measurement:

   ```js
   ({
     viewport: window.innerWidth,
     clientWidth: document.documentElement.clientWidth,
     contentWidth: document.documentElement.scrollWidth,
     pageOverflows: document.documentElement.scrollWidth >
       document.documentElement.clientWidth
   })
   ```

   Require `pageOverflows: false`. Save a screenshot, viewport, measurements,
   selected view, date and a non-sensitive account-role description.
6. Select an existing school using the header selector. Inspect the Owner's
   school snapshot, not an impersonated School Admin dashboard. Repeat the
   scroll/measurement checks, then return to the network view.
7. Repeat steps 2–6 at **1440 × 1000**. Check the desktop sidebar does not overlap
   the content, the header aligns and both dashboard columns fit. Also check
   **820 × 1180** if possible, because the sidebar reduces tablet content width.
8. Do not approve applications, record assistance, verify bank credit, change
   rules, start checkout, send messages or operate any financial control.
   If a problem is found, record the affected view, width, screenshot and
   overflowing element. Stop short of changing application behavior.

Acceptance remains open until genuine authenticated evidence is supplied.
Source/DOM containment tests do not substitute for this check.

## 2. Exact SQL source reviewed

Artifact: `lib/db/drizzle/0179_restore_direct_and_bro_guards.sql`.

SHA-256:
`09e2f989c23d80d580bc2428ddd38b962715f11d0c70700e975ab5ca9809c21b`.

The isolated test compared the repair and runtime definition contract directly
with approved 0176–0178 source. All four bodies and all nine trigger
table/function/event bindings matched. These are restoration definitions, not
new eligibility or pricing rules.

| Function | Intended behavior |
| --- | --- |
| `guard_student_direct_history()` | Reject UPDATE and DELETE of direct financial history. |
| `guard_student_direct_attempt()` | Reject DELETE, frozen-identity changes and updates to PAID/FAILED terminal attempts. It does not add the application's full nonterminal transition matrix. |
| `guard_bro_term_commission_history()` | Reject UPDATE and DELETE of BRO earning evidence. |
| `guard_bro_term_commission_scope()` | Before earning INSERT, require matching school/student/academic term/attribution/partner, an eligible verified PAID direct attempt, matching verification time and provider transaction, and the approved activated BRO rule effective at Lagos term start. |

Seven direct triggers cover reviews, obligations, events, attempts, release
requests, release decisions and review bindings. Two BRO triggers protect
entitlement history and validate earning INSERT scope. All are BEFORE ROW,
explicitly normally enabled, without WHEN filters or trigger arguments.

The existing predicates retain the 320000-kobo NGN direct obligation with zero
school/BRO split and the independently approved 15000-kobo BRO rule. The repair
does not activate either rule, authorize accrual, charge anyone or pay a BRO.

The runtime contract checks exact bodies, signatures, execution properties,
function identity, trigger timing/events/bindings and enablement. Structural
inventory alone is insufficient. The repair is transactional, requires
PostgreSQL 14+, uses a 2-second lock timeout and a 30-second **per-statement**
timeout, and explicitly re-enables its nine triggers. Timeouts do not eliminate
write blocking or establish an acceptable Production maintenance window.

## 3. Fresh focused verification

Executed without shared Development/Production database or provider access:

```sh
env -i PATH="$PATH" HOME="$HOME" LANG=C.UTF-8 NODE_ENV=test \
  node scripts/src/financial-guards-native-check.mjs

pnpm --filter @workspace/api-server exec vitest run \
  src/services/financial-guard-schema.test.ts \
  src/services/financial-history-writes.test.ts \
  src/services/direct-student-live-payments.test.ts \
  src/services/bro-commission-policy.test.ts

pnpm --filter @workspace/api-server run typecheck
```

Results:

- **26/26 isolated PostgreSQL checks passed.** Exact source/catalog comparison;
  missing/weakened/wrong/disabled guards rejected; repair repeatability;
  failed-install rollback; actual append-only/identity/terminal/BRO behavior;
  populated fictional direct/BRO/legacy records preserved.
- **133/133 unit tests passed in four files:** guard schema 36, application
  financial-history writes 69, direct payments 5, BRO policy 23.
- **API TypeScript check passed.**

These tests do not prove actual Production catalog state, restricted runtime-role
permissions, primary/replica binding, backup recovery, provider behavior or
supported release delivery. No fresh Production queries were made.
The earlier frontend 40-test pass/typecheck/build remain earlier evidence;
they were not rerun here because no frontend application source changed.

## 4. Delivery decision

Replit Support's explicit confirmation is binding for this plan:
**Publish does not transfer/track these custom functions/triggers, and manual
SQL-console installation is unsupported.** Neither path is an approved remedy.

Official documentation reviewed:

- https://docs.replit.com/features/data-and-storage/development-and-production
- https://docs.replit.com/features/data-and-storage/connection-details
- https://docs.replit.com/features/data-and-storage/sql-database

The pages describe structural publishing and connection access. They do not
establish a supported release/lifecycle contract for these 13 objects.
Permission or technical ability to connect with an external SQL client is not
support for managed-Production DDL. Generic search summaries suggesting console
SQL or deployment migration commands were rejected where they contradicted
Support's specific confirmation and the managed-Production boundary.

**No supported, verified procedural release mechanism for this managed target
was identified.** Do not add a migration filename, startup/build DDL, release
hook, custom managed-Production runner, direct-client workaround or ledger edit
to bypass the gap.

### Available decisions, not execution instructions

1. **Safe interim:** retain Option A and all existing fail-closed gates. Continue
   only already-permitted operations. Keep direct LIVE release and dependent BRO
   operations blocked where procedural readiness fails. Application protections
   do not prevent privileged/direct SQL bypass and are not all-writer equivalence.
2. **Managed database:** ask Replit Support for a documented supported mechanism
   for installation, subsequent changes, tracking and recovery of these exact
   objects, or confirmation that none exists. A generic instruction to publish
   again is insufficient unless actual procedural coverage is demonstrated.
3. **Separately approved external PostgreSQL alternative:** a PostgreSQL developer
   can assess keeping the same financial model/schema on a customer-controlled
   PostgreSQL service with a provider-supported migration lifecycle. This is a
   future hosting/data-migration decision, not an approved switch or a verified
   deployment plan. Validate Replit runtime connectivity, TLS, pooling, region,
   networking, backups and ownership before proposing a cutover. Do not assume
   the current database is external from its name or connection fingerprint.
   An external developer may review/test now; they must not install SQL on the
   current managed Production target through an unsupported path.

## 5. Stages and exit criteria

| Stage | Work and accountable party | Exit condition |
| --- | --- | --- |
| A — UI evidence | Owner/authorized tester follows section 1 in Development. | Network and selected-school mobile/desktop screenshots and overflow results accepted. |
| B — source validation | Completed in this review. Preserve the unchanged artifact and Option A. | Matching hash, 26 PostgreSQL checks, 133 unit tests and API typecheck; local evidence only. |
| C — supported mechanism | Replit Support determines managed-target capability; PostgreSQL developer reviews definitions and operator requirements. | Written supported lifecycle and exact deployment/verification/recovery procedure, or an explicit external-hosting feasibility decision. |
| D — recovery rehearsal | Only after separate authorization: operator proves serving-primary/resource binding, approved retained-data baseline, recovery point and isolated restore; rehearses exact supported plan and runtime-role permissions. | Matching definitions, preservation and behavioral results; measured lock/downtime impact and accepted RPO/RTO. No managed-Production workaround. |
| E — term go/no-go | Owner reviews each school's actual academic-term dates, existing free-rollout/collection and grace policy, payment availability and essential-access safeguards. | A feasible, explicitly approved term plan. Do not use January 1 as a substitute for saved school dates, silently waive/change fees, or let an unavailable collection path be treated as ready. |
| F — future release decision | Owner separately authorizes an exact supported release and recovery window; an authorized operator executes only that supported mechanism. | Post-release catalog/body/binding/enablement verification, retained-history checks and role tests. This stage is not authorized now; it does not activate LIVE payments. |

## 6. Costs, risks and blockers

- No external service was provisioned and no payment/transfer was initiated.
  Exact agent/platform usage charges were not inspected or estimated.
- Support review and an external PostgreSQL specialist may add lead time and
  professional-service cost. No quote or delivery date is established.
- An external database would add hosting, storage, backups, monitoring and
  potentially network-transfer costs, plus migration/rehearsal and operational
  ownership. None is provisioned or budget-approved.
- A future repair can block concurrent writes or fail on permissions,
  dependencies or catalog drift. A hosting cutover additionally risks inconsistent
  history, connection failures, replication confusion and downtime.
- Application-only enforcement cannot protect against direct/privileged SQL.
  Even row triggers do not protect TRUNCATE or privileged DDL.
- Open blockers: authenticated UI evidence; supported procedural delivery;
  current target/catalog evidence; authoritative primary/recovery binding;
  approved isolated restore/rehearsal and permissions; next-term operational
  go/no-go. Payment-provider and financial release prerequisites remain separate.

**Conclusion: source-validated, not Production-ready. No Production action is
authorized by this document.**
