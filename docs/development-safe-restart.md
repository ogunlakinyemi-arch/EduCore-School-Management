# Development Safe Restart Mode — implemented, not activated

## Execution boundary

This change implements a code-only safety boundary for the existing normal API
entry point. It does not authorize or perform a restart, shared-preview
activation, database connection/mutation, migration, provider request, setting
change or deployment. Financial rules and the previously prepared migration
remain unchanged. See `development-financial-stabilisation.md` for that separate
implementation and its continuing release blockers.

## Selection and fail-closed startup

The explicit process argument is `--development-safe-restart`. It is deliberately
not an environment variable or persisted switch; existing notification/provider
settings are not changed. No command to activate it has been executed.

The normal entry accepts this argument only when `NODE_ENV` is exactly
`development` and `REPLIT_DEPLOYMENT` is absent. It refuses Production, deployment
markers (including an empty marker), test/unknown contexts, duplicate safety
arguments and combinations with terminal-test modes. Unknown startup arguments
now fail rather than silently selecting normal startup after a misspelled
safety option. The configured argument-free Production command is unchanged.

Sequence with the explicit option:

1. Validate the option and Development boundary.
2. Install irreversible in-process I/O deny guards. A missing/non-writable
   required API fails startup; there is no partial-install success or normal
   fallback.
3. Read/hash the local launcher and deferred normal bundle, without executing
   the normal bundle.
4. Load the restricted same-port HTTP handler. No normal application, business
   routes, database, SDK/provider, pino logger or worker is imported.
5. Serve only the safe diagnostic allowlist. Do not initialize any Telegram,
   Owner notification, subscription/attendance maintenance, reconciliation,
   teacher-notification, delivery or startup-verification job.

Safe-start failures use a fixed local stderr message, not the pino transport
worker. Conflicting safety requests through the terminal entry also fail
without loading that logger. There is no HTTP switch, automatic expiry or
runtime restore path. Leaving the mode requires a separately authorized new
process, not removal of a notification pause.

With no safety option, existing normal startup and existing send controls remain
in effect. This work does not unpause workers or silently authorize any sends.
Production cannot use the option to bypass normal authorization/readiness gates.
This is a configuration/code boundary, not protection against an administrator
rewriting the executable or falsifying all deployment identity inputs.

## Read-only local functionality and blocked ingress

Only GET/HEAD on these exact paths is allowed:

- `/api/healthz`
- `/api/safe-restart/status`

Responses are uncached and identify the safe mode, no database connection,
unstarted workers, in-process guard state, rejected-attempt count and SHA-256
hashes of the launcher and normal bundle. No secrets, provider addresses,
database identity or request content are exposed.

Every other request receives HTTP 503 with
`DEVELOPMENT_SAFE_RESTART_ACTIVE`, `retryable: true`, and `Retry-After: 60`.
This includes ordinary GETs, `/api/readyz`, authentication/proxy endpoints,
device ingestion, manual dispatch, health-diagnostic provider routes, all payment
callbacks and communication receipts. Requests never reach ordinary parsers,
authentication, business routes or callback acknowledgement/verification.
WebSocket upgrades and HTTP CONNECT are closed without tunnelling.

Safe mode is **not** a financial dashboard or a read-only copy of tenant data.
An ordinary GET can contact a provider, initialize data or require Clerk, so
ordinary reads are not casually allowlisted. Database readiness is deliberately
not claimed. Existing authentication has not been weakened to expose such reads.

## Transport coverage

The compiled startup launcher contains no normal routes/services, provider SDKs,
database implementation or logger. This excludes, before initialization:

| Boundary | Safe-mode treatment |
| --- | --- |
| Telegram health, getMe, getWebhookInfo, getUpdates, sends | Telegram worker/provider/routes not imported or invoked |
| BulkSMSNigeria and Termii SMS | Workers, manual-dispatch routes and adapters not imported |
| Resend and configured HTTP email | Same; no email initialization or sends |
| Web push | No provider, device registration or dispatch route initialization |
| Flutterwave/Paystack/payment verification, checkout, refunds, transfers | No financial routes/adapters or callback processing |
| Clerk authentication, proxy, identity and invitations | No Clerk middleware, SDK or identity routes |
| Object storage and local signing/credential sidecar | No storage clients, upload/document routes or sidecar requests |
| Current/future ordinary routes and callbacks | Default-deny ingress, not a selected endpoint blacklist |

Defense in depth installs **57** deny boundaries on this tested Node runtime:
global fetch; application intervals; HTTP(S) request/get; HTTP/2 connect;
TCP connect/createConnection/socket connect; TLS connect; UDP connect/send;
DNS callback/promise lookup/resolve APIs and Resolver construction;
timer-module intervals; child-process execution; worker-thread construction.
Guards reject before invoking original functions and cannot be overwritten or
restored through their installed properties. Synchronous/constructor calls throw;
async calls reject with `DEVELOPMENT_SAFE_RESTART_IO_BLOCKED`. Rejections do not
include supplied URLs, credentials or message bodies.

No application job timers are registered in the safe path. The isolated startup
fixture uses a fake HTTP server and proves zero application timeout/interval
registration; it is not a measurement of Node's internal HTTP housekeeping
timers in a live server.

## Compiled import boundary

A source-level dynamic import alone is insufficient: bundling can hoist external
SDK imports ahead of a deferred initializer. The build now emits the normal API,
terminal server and pino logger as separate deferred modules alongside the
existing entry points. Configured build/start commands and service settings
are unchanged.

The normal launcher imports those modules only after selecting their respective
non-safe paths. A build-metafile regression checks that its inputs contain no
business routes/services, node_modules, DB implementation or logger, and that
its static imports are Node built-ins only. The complete normal bundle is
still built; it is intentionally not loaded in safe mode.

## Network-isolation limits

**This is not OS/kernel-level egress isolation and not an absolute zero-network
guarantee.** No firewall, namespace, deployment or Replit configuration was
changed. No supported per-process Replit egress mechanism was established or
verified in this workspace. Platform availability was not inferred from missing
configuration; no external documentation or provider lookup was made under the
no-real-request constraint.

The enforced boundary is the guarded API entry, inaccessible business routes
and the installed in-process APIs. It is not a hostile-code sandbox. Native
addons, preloaded code holding earlier transport references, inherited open
connections, alternate runtimes/internal bindings, other processes, browser
activity and remote services are outside that guarantee. No unrelated workflow
is stopped or reconfigured. Standalone scripts that bypass this API bootstrap
are not silently converted into safe mode.

## Verification

Tests use clean child environments, fake transports, synthetic requests/responses
and disposable build outputs. They do not start the shared API, open a test HTTP
listener, connect to a database or invoke a provider.

Focused verification command (tests only):

    pnpm --filter @workspace/api-server exec vitest run \
      src/lib/safe-restart.test.ts src/lib/safe-restart-io.test.ts \
      src/lib/api-bootstrap.test.ts safe-restart-build.test.mjs

Coverage includes strict Development-only selection and Production refusal;
guard-before-loader ordering; absent worker/queue/probe entry; no normal fallback
after failure; every blocked ingress class; HEAD/cache behaviour; fake listener,
upgrade and tunnel handling; mock provider boundary rejection; immutable guards;
missing/non-writable boundary failure; and sanitized errors.

The compiled integration fixture first replaces every original I/O boundary
with a fake that cannot contact a network, and replaces HTTP server creation
with a fake listener. It then executes the actual newly compiled launcher and
actual guard installer. Initial rejected attempts, original transport calls and
application timeouts are all zero. It subsequently invokes all 57 installed
boundaries, verifies every rejection and verifies original transport calls
remain zero. This is stronger than merely observing no log messages, but is
still an isolated fake-transport fixture, not live shared-preview acceptance.

The full build is written to a disposable temporary directory and removed;
existing `dist` output and running processes are not replaced. API typecheck
and whitespace checks are separate. Exact final test counts are reported in
the delivery summary. No browser/login test, real provider diagnostic or live
network-isolation test is performed.

Final passing results, combining the focused run and the targeted rerun after
adding two ordinary-startup preservation cases:

| File / check | Result |
| --- | --- |
| `src/lib/safe-restart.test.ts` | 48 passed |
| `src/lib/safe-restart-io.test.ts` | 36 passed |
| Existing `src/lib/api-bootstrap.test.ts` | 39 passed |
| `safe-restart-build.test.mjs` | 1 passed; full disposable build, compiled fake-listener startup and all 57 I/O denials |
| API TypeScript check | Passed |
| `git diff --check` | Passed |

Total: **124 passing tests across four files**. No full-repository suite was run.

## Activation review gates — no authorization implied

Before any later activation, obtain separate explicit approval covering the
exact Development launch command and the temporary loss of operational API
routes/callback handling. Do not change notification settings to accomplish it.
After an authorized controlled activation, compare both reported bundle hashes
with the reviewed local build, check mode/guard status and rejected attempts,
and verify that the correct new listener—not an older process—serves the preview.
Any unexpected guard attempt is a failed safety check, not proof of an allowed
send. Do not infer that financial routes are running from safe-mode liveness.
Do not include migrations, data changes or other workflow restarts.

Current decision: **implementation ready for review; shared-preview activation
remains on hold. No absolute zero-network certification is claimed.**

## Exact changed-file manifest

Modified:

- `artifacts/api-server/build.mjs`
- `artifacts/api-server/src/index.ts`
- `artifacts/api-server/src/terminal-test-entry.ts`
- `artifacts/api-server/src/lib/api-bootstrap.ts`

Added:

- `artifacts/api-server/deferred-entry-imports.mjs`
- `artifacts/api-server/src/lib/safe-restart-policy.ts`
- `artifacts/api-server/src/lib/safe-restart-io.ts`
- `artifacts/api-server/src/safe-restart-server.ts`
- `artifacts/api-server/src/lib/safe-restart.test.ts`
- `artifacts/api-server/src/lib/safe-restart-io.test.ts`
- `artifacts/api-server/safe-restart-build.test.mjs`
- `docs/development-safe-restart.md`
