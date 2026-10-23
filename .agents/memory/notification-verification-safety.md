---
name: Notification verification safety
description: Development-only delivery evidence and the approval boundary for contacting recipients
---

Unavailable-channel tests must explicitly isolate each channel's configuration,
not inherit workspace credentials or assume selecting a mock Email provider
also makes Push unavailable.

**Why:** The workspace's usable VAPID configuration made an old unavailable-Push
fixture permit a default channel; saved-setting presence metadata did not
establish what the test process inherited. A fixture failure must not motivate
changing real delivery authorization.

**How to apply:** Stub transport selection and VAPID inputs independently in
no-network tests and restore them afterward. Retain synthetic positive-configuration
cases behind the launch hold; never inspect real key values to repair a fixture.

Notification-channel integration is Development-only except the explicitly approved opt-in Production Telegram path; see [Telegram Production policy](telegram-production-policy.md). Configured provider credentials do not by themselves authorize real sends, real emergency broadcasts, or contact with real parents. Use isolated fixtures and no-network adapters until the user explicitly approves a controlled provider test.

**Why:** The notification specification expressly forbids publishing, Production changes and unauthorized messages. A pre-existing SMS credential is not permission to send. Simulated acceptance, native receipt fixtures and browser mocks cannot establish physical delivery.

**How to apply:** Keep missing delivery credentials and physical installation/push marked Not Yet Verified. Retire temporary identity-provider accounts, revoke their device credentials and preserve immutable school history. Report signed-in browser verification separately from unit, native SQL and anonymous screenshot results.

Development Resend sends must be explicitly restricted to approved controlled recipients; enabling email must not enable live SMS/push or drain existing messages to real parents.

**Why:** The communication worker dispatches queued events automatically. Merely selecting a real provider can contact people whose old queued notifications were never approved as test sends.

**How to apply:** Keep the Development recipient allowlist mandatory for real email, preserve no-network behavior for other channels and enforce the same provider selection in scheduler and campaign/retry paths. Leave Clerk-owned invitation and authentication emails intact instead of duplicating them through transactional email.

Resend's idempotency retention is finite (24 hours), so ambiguous sends must remain held for reconciliation rather than retried indefinitely.

**Why:** Provider-side deduplication expires. A later retry can create a duplicate even when the key is unchanged.

**How to apply:** Retain durable local event/delivery identities and uncertain-outcome handling; acceptance, a mocked delivery event and a read-only domain check are not physical inbox-delivery evidence.

An HTTP 401 from Resend domain listing does not alone establish an invalid sending key.

**Why:** The configured key returned `restricted_api_key` on domain listing but successfully sent a controlled email, whose receipt the user confirmed on 2026-10-07. Restricted sending access and management/read access are separate; requiring broader privileges on the listing failure alone is unjustified.

**How to apply:** Inspect the sanitized provider error category, not just the HTTP status. Keep domain verification and sending verification separate; use an explicitly approved controlled-recipient send to establish sending access.

The Owner requests supported IN-APP, EMAIL, PUSH and TELEGRAM channels across
notification categories, with SMS unavailable until separately approved. Older
attendance/emergency SMS permission is not current authorization to enable SMS.
School choices cannot expand Owner permissions.

**Why:** On 2026-10-23 the Owner explicitly requested every supported channel
except SMS, without real provider calls, sends, Production configuration changes,
database changes, restarts or publication during preparation.

**How to apply:** Preserve saved policy/history, recipient checks, consent,
deduplication and Development send locks. Missing provider configuration is not
fixed by removing unavailable labels. Permission across categories must not
silently subscribe recipients or broaden existing saved school/Owner rules.

During payment safety testing, an earlier controlled-recipient email approval does not authorize sending notifications. Keep payment-test suppression independent of recipient allowlists and scheduler pauses, and cover manual dispatch and direct real-provider transports too.

**Why:** Development can have real Resend delivery configured for approved recipients even while its scheduled worker is paused. Connecting a financial webhook must not implicitly reuse that earlier send approval.

**How to apply:** Keep the lock Development-only, fail without network access or a false delivery claim, and distinguish saved code/configuration from the running server. When restart is forbidden, report activation as blocked rather than claiming the new safeguard is active.

Telegram has a separately authorized Development-only opt-in so the requested
channel can run without changing existing SMS/email send locks or unpausing
their workers. Disable that opt-in before any future QA that must suppress
all external notifications, including Telegram.

**Why:** The user explicitly requested functioning Telegram while preserving
existing SMS restrictions. The old global worker pause otherwise blocked the
new independent channel as well.

**How to apply:** Preserve the existing locks. Respect Telegram's explicit
Development opt-in, live Owner/school policy and confirmed parent consent;
never treat bot health as recipient-delivery evidence.