# Telegram in the published Yetenia EduCore application

This is a source implementation, not an activation or delivery verification.
No Telegram calls, Production changes, real sends, restarts or publishing are
authorized by implementation/testing alone.

## Required server-only configuration

- `TELEGRAM_BOT_TOKEN`: valid credential for the intended Production bot.
  Never put it in a `VITE_*` variable, browser code, screenshots, logs or chat.
- `SESSION_SECRET`: stable, high-entropy encryption secret of at least 32
  characters. Existing encrypted chat links depend on this exact secret.
  Rotation requires a reviewed relinking/encryption plan; do not silently replace it.
- `EDUCORE_PRODUCTION_TELEGRAM_ENABLED=true`: explicit Production-only runtime
  opt-in. Omitted or any other value leaves Production delivery/polling disabled.
  It does not enable SMS, email, push or Flutterwave LIVE.
- The normal API runtime must identify itself as Production (production
  `NODE_ENV` or the deployment marker). Do not fake runtime-managed variables.
  The app's existing same-origin allowlist must include its published host.
- `EDUCORE_TELEGRAM_ALLOWED_ORIGINS`: when the published/custom host is absent
  from the platform-provided host list, set this non-secret configuration to the
  exact HTTPS app origin, or comma-separated explicitly trusted HTTPS origins.
  Include scheme and optional port, but no path/trailing slash. Do not use
  wildcards. This avoids altering platform-managed host variables. HTTP origins
  are not accepted through this additional published-origin allowlist.

Secret existence has been checked without reading values. Credential validity,
encryption quality, deployment origin, database readiness and real delivery have
not been verified against Production.

## Owner setup and release checklist

1. Review the code/tests and separately authorize a release/restart. Leave all
   workers stopped during this implementation step.
2. Use a dedicated Production bot. Do not let a Development instance or another
   application poll the same bot. Use separate Development credentials.
3. In a separately authorized Production readiness review, confirm the existing
   Telegram link/challenge/poll tables, encryption compatibility, and Telegram
   channel CHECK constraints are present. No migration is applied automatically.
   Missing storage leaves delivery unavailable; approve any missing migration
   separately rather than bypassing the gate.
4. Review queued Telegram records and current Owner/school channel permissions
   before enabling the switch. Do not replay an unreviewed historical backlog.
5. After an approved release, the active Platform Owner may run **Check bot
   configuration**. It uses only `getMe`/`getWebhookInfo`; it never sends,
   polls, changes webhooks, claims queue records or updates delivery readiness.
   The check records a local audit event. Diagnostic success is not delivery
   authorization or proof of receipt.
6. If an existing webhook is reported, resolve bot ownership/integration
   separately. The app will not delete or replace that webhook.
7. After prerequisites/backlog review, separately authorize setting the
   Production opt-in and the release/restart needed to load it. The Telegram
   worker independently validates credentials, webhook compatibility and storage
   before polling or sending. Diagnostic clicks cannot satisfy this validation.
8. Enable Telegram only for intended Owner-authorized event categories and
   school choices. Each recipient must be an eligible linked parent, start the
   bot in their own private chat, and explicitly confirm consent in EduCore.
   Admin-known invitation tokens cannot complete final account binding.
   Unlinked users, unrelated schools/children and withdrawn preferences are
   excluded again at dispatch. Other recipient roles remain unsupported rather
   than being implicitly subscribed.
9. A separately authorized controlled-recipient notification can establish
   Telegram acceptance; actual recipient observation is needed for receipt.
   `sendMessage` acknowledgement is not a read receipt.

## Safety and operations

The worker uses the existing durable update cursor/advisory lock, queue claims,
notification/delivery deduplication, category preferences, school/audience checks
and delivery attempt records. Per-chat pacing and provider 429 backoff remain.
Uncertain send outcomes are held, not blindly retried: Telegram has no
`sendMessage` idempotency key. Missing delivery readiness defers queued Telegram
records rather than exhausting their attempts.

Turning the Production opt-in off blocks new polling/sends; revoke parent consent
to cancel their pending deliveries. A request already accepted by Telegram cannot
be recalled by disabling a flag. Read-only diagnostics remain available while
delivery is disabled, and expose only allowlisted classifications and bot username.
No token-bearing URLs, raw provider bodies, chat IDs or encryption material are
returned by diagnostics.

Development sending locks and all unrelated payment/LIVE gates remain unchanged.
