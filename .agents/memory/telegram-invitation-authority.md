---
name: Telegram invitation authority
description: Why Admin-visible invitation links cannot serve as final parent chat-binding credentials.
---

A School Admin's Telegram invitation starts onboarding only. Final delivery-chat
binding requires a fresh personal token issued to the signed-in parent, followed
by the parent's bot start and explicit final consent. Keep optional phone
matching supplementary and keep school/child context inside authenticated pages.

**Why:** The Admin necessarily knows the copied/printed invitation token and
could start it in their own chat. A generic private-account label cannot let
the parent reliably distinguish that chat from their own. Parent-owned token
issuance prevents that substitution without automatic bot messages.

**How to apply:** Do not simplify the flow by allowing an Admin-known token to
complete linking after a generic confirmation. Retain the distinction when
changing QR links, deep links, consent UI, audit retention or onboarding copy.
Never purge the authoritative invitation-origin evidence while its token can
still be used.
