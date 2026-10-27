# Hosted Payments: Development TEST configuration

## Scope and current result

Only Development TEST preparation is authorised by this change. No Production
configuration/data, separate school-billing LIVE selector, LIVE checkout SQL
package, application database, provider account or running workflow was changed.
No checkout, charge, transfer or provider request was made.

The following **non-secret settings were saved in the Development scope only**:

| Key | Value |
|---|---|
| `EDUCORE_HOSTED_PAYMENTS_ENABLED` | `true` |
| `EDUCORE_HOSTED_PAYMENTS_MODE` | `TEST` |
| `EDUCORE_HOSTED_PAYMENTS_PUBLIC_URL` | `https://f8ad4f13-ad39-4544-9de2-99a39f6d556c-00-1pkz80o0gbypm.riker.replit.dev` |

The URL was taken from this workspace's current preview domain and returned
HTTPS 200 at its root. If the workspace domain changes, review the new actual
Development URL; do not replace it with a Production URL or add a generic fallback.

**The running API was not rebuilt/restarted to load these settings or source
changes. Saved configuration is not evidence of a successful runtime reload.**

## Exact remaining secret

Existence-only metadata confirms:

- `FLUTTERWAVE_SECRET_Test_Key`: present. Its value was not inspected.
- `FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH`: **absent**.

The operator must add the actual dedicated TEST webhook verification hash as
`FLUTTERWAVE_TEST_WEBHOOK_VERIF_HASH` in **Development-only Replit Secrets**.
Do not put it in Shared or Production scope, overwrite the existing TEST key,
copy `FLUTTERWAVE_WEBHOOK_VERIF_HASH`, or copy a LIVE hash/secret. Do not invent a
value just to remove the warning. If the appropriate scoped secret cannot be
added, leave the feature blocked.

The existing configuration contract reads this exact variable and passes it to
the hosted adapter's existing webhook authentication mechanism. Missing-key
diagnostics now identify the absent secret and hash independently instead of
implying that an existing TEST secret is also missing.

No hash was requested, generated, inspected, saved or sent to a provider here.
The missing hash keeps Hosted Payments fail-closed despite the staged enablement.
The separate school-payout money-moving feature was not enabled.

## Actual PostgreSQL journal tests

Run from the workspace root:

```sh
NODE_REAL=$(node -p 'process.execPath')
env -i PATH="$PATH" HOME=/tmp LANG=C.UTF-8 NODE_ENV=test \
  "$NODE_REAL" scripts/src/hosted-journal-native-check.mjs
```

The controller accepts no connection arguments and rejects inherited database,
provider or application credential/configuration keys. It creates a fresh
private `/tmp` cluster, disables TCP, uses an explicit private Unix socket and
role, and checks process arguments, socket, owner and data directory **before**
querying it. The suite independently verifies the server's data directory,
role, database and disabled network listener before fixture DDL.

The suite imports the actual pure Drizzle schema, never the application database
client. It creates `hosted_checkout_orders` and `hosted_checkout_events` with their
current columns, defaults, CHECKs, unique indexes and foreign keys. Referenced
parent tables are deliberately minimal fictional ID-only stubs, not copies of
school, student, financial or Production records.

It installs the exact `HOSTED_HISTORY_GUARD_BODY` with canonical
`hosted_history_immutable` statement triggers covering UPDATE, DELETE and
TRUNCATE on both tables, and exercises the real `hostedDatabaseReady` and
`appendHostedEvent` implementations.

**11 native PostgreSQL cases passed:**

- Exact enabled bindings pass the readiness probe.
- UPDATE, DELETE and TRUNCATE are rejected on both tables, including attempts
  with empty row predicates.
- Append and idempotent replay work; duplicate economic payment events do not.
- Provider-identity uniqueness, verified amount CHECK and order/environment FK
  are enforced.
- Disabled/missing triggers, a missing event table, `SECURITY DEFINER`, altered
  function text and wrong row-level trigger coverage all fail closed.
- Each negative DDL test rolls back and confirms canonical readiness is restored.

The disposable server is stopped and its private files removed, including after
a failed test. There is no fallback to an application connection.

This is **not** proof that the current Development or Production app database has
these objects installed, that a real app role has the correct grants, or that the
whole existing application schema is compatible. No SQL ran against either app
database. Any future application-schema installation/review, real TEST webhook
acceptance, runtime reload or payment test requires separate appropriate approval.

## Focused source checks

API typecheck and 47 policy/adapter/payout/receipt tests passed. Configuration
tests cover missing dedicated TEST hash/key without generic or LIVE fallback,
explicit selection instead of borrowing the separate LIVE selector, unsafe
public URLs, and the existing Development LIVE prohibition. Provider transports
are mocked; no real credentials are used by these tests.
