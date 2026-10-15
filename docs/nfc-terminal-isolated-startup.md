# Isolated terminal test startup — prerequisites only

**Not provisioned or started.** This change does not create a database, change
secrets/settings, build/restart the preview, apply a schema or verify live data.
The existing terminal endpoint and its payload/response contract are unchanged.

## Fail-closed boundary

An opt-in process accepts only a named **private local Unix-socket** PostgreSQL
target. TCP hosts, shared database URLs and generic PG credentials are never
used in this mode. NODE_ENV alone never establishes isolation.

Required **non-secret process configuration** (illustrative names/ports only):

| Variable | Required value/example |
| --- | --- |
| `EDUCORE_TERMINAL_TEST_MODE` | `isolated` |
| `NODE_ENV` | `development` |
| `REPLIT_DEPLOYMENT` | Must be absent, not even an empty value |
| `EDUCORE_DEVELOPMENT_WORKERS_PAUSED` | `true` |
| `EDUCORE_TERMINAL_TEST_CONFIRM` | `DISPOSABLE_LOCAL_ONLY` |
| `EDUCORE_TERMINAL_TEST_TARGET` | `nfc_qa` |
| `EDUCORE_TERMINAL_TEST_DB_HOST` | `/tmp/educore-terminal-test-nfc_qa` |
| `EDUCORE_TERMINAL_TEST_DB_NAME` | `educore_terminal_test_nfc_qa` |
| `EDUCORE_TERMINAL_TEST_DB_USER` | `educore_terminal_test` |
| `EDUCORE_TERMINAL_TEST_DB_PORT` | `55439` |
| `EDUCORE_TERMINAL_TEST_HTTP_PORT` | `18081`, different from preview/DB ports |

The private directory must already exist, have no group/other permissions, be
owned by the process user, and not resolve through a symlink. The actual local
socket must exist, be a socket (not a symlink), and have the same owner.
Missing/invalid configuration or filesystem verification failure stops startup
before loading the application or database module. Any supplied test-mode value,
even a typo, cannot fall back to the normal database or startup path.

The PostgreSQL pool independently repeats the gate before construction. It uses
only the explicit local socket/database/role, SSL off and an empty-password
callback, not inherited database connection strings or passwords. The disposable
cluster must be configured separately to allow this local test role.

These checks establish the **configured local destination**, not schema readiness,
database contents, server provenance or successful authentication. They are not
a substitute for independently provisioning and approving a disposable cluster.
Do not point the private socket at a proxy, tunnel or existing operational server.

## Worker-free process

The distinct terminal entry point serves only loopback `127.0.0.1`, health and
the existing terminal events router. It does not load normal server startup:
no subscription evaluation, finance notification reconciliation, communication
dispatch, startup database identity probes or scheduled business workers.
Startup performs **no database connection, SQL, writes or migrations**.
An actual later scan will connect and write attendance/receipts to the approved
test database; that is not part of the configuration check.

After separately authorized configuration/provisioning and a fresh API build:

- `pnpm --filter @workspace/api-server run check:terminal-test` checks only
  non-secret configuration/filesystem metadata; it opens no HTTP listener or DB.
- `pnpm --filter @workspace/api-server run start:terminal-test` starts the
  separate worker-free loopback process, not the preview.

These commands are documented, **not run**. The separate compiled entry file
must exist; an old normal-server bundle cannot silently ignore a new test flag.
The normal preview's launcher remains normal unless test mode is explicitly set.

## Still required before one real scan

1. Explicit approval and separate provisioning of a disposable local PostgreSQL
   cluster, named database and role satisfying the gate. None exists by virtue
   of this code change; no unknown credentials are requested or reused.
2. Separately approved schema setup and synthetic school/student/card/device,
   saved ENTRY/EXIT audit configuration and test-only device credential.
   Startup never creates these or runs migrations.
3. A fresh build and configuration-only check, then authorized process startup
   on its distinct loopback port. Do not restart the existing preview.
4. Separate authorization/exposure for vendor staging or physical hardware;
   this localhost-only mode is not a deployed staging host or public terminal URL.
   Keep terminal firmware queueing/retries on the terminal, preserving IDs/times.

Offline gate tests use synthetic environments, mocked filesystem metadata and
stub startup loaders; they do not connect to a database or establish live staging.
