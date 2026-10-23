# Canonical invitation, referral and signup URLs

Deployment metadata verified on 2026-10-23 reports
`https://educore.yetenia.com` as the primary URL and the old `*.replit.app` domain
as an additional URL. `PUBLIC_APP_URL` is not currently configured.

All server-generated onboarding destinations now use one canonical resolver:
`artifacts/api-server/src/lib/canonical-public-url.ts`.

## Audited paths

- School Admin and school user invitations: all create/retry/replacement paths
  in `school-invitations` use the invitation wrapper.
- Partner, Partner employee, school onboarding and corrected-email invitation
  paths in `partners` use the same wrapper.
- Internal employee invitations use the same wrapper.
- Existing and newly generated Partner referral links now return an absolute
  canonical `/school/register?ref=...` URL, not a host-relative share link.
- Public signup/signin paths are supported by the same resolver. The browser's
  ordinary internal navigation remains relative; the school registration
  redirect still carries `ref` into `/sign-up?applicantType=SCHOOL_ADMIN`.

The wrapper only accepts `/accept-invitation`; the shared resolver permits only
the reviewed onboarding routes. Existing paths and encoded opaque tokens are
preserved. Neither request Host/Origin/forwarded headers nor workspace/deployment
hostname environment variables select the Production destination.

Clerk sends the invitation email using the supplied `redirectUrl`; no duplicate
application email template builds another URL. Application-decision emails
contain no signup/invitation link. No Clerk dashboard template or configuration
was changed. No real invitation was sent or resent to verify physical receipt.
Already-sent emails and existing provider invitations were not rewritten.

An explicitly configured trusted `PUBLIC_APP_URL` can select a different
verified custom portal domain. Replit-hosted Production values, private hosts,
non-HTTPS origins and origins containing credentials, paths or query strings
fail closed. Development invitations intentionally remain on the explicit
Development Clerk host, not on the Production identity environment.

## Payment isolation

The old `PUBLIC_PRODUCTION_ORIGIN` export remains solely for the pre-existing
payment-return helper that imports it. It is no longer used by invitations.
This preserves payment behavior without modifying payment settings or code.
Do not reuse that compatibility constant for onboarding.

## Tests and release

Canonical-host tests cover partner/school/internal invitation contexts, referral
and signup paths, token preservation, configured portal overrides, stale Replit
configuration rejection and Development isolation. Existing routed invitation
tests assert the canonical destination for mocked Clerk requests.

The code must be published before newly issued Production invitations use it.
No automatic resend or token regeneration is part of publishing.
The separate Telegram storage migration approval is documented in
`telegram-storage-correction.md`; publishing code alone cannot repair it.
