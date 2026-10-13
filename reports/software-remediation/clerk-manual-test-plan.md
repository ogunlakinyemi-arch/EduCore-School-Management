# Clerk invitation manual test plan — not executed

Date: 2026-10-13. For separately authorized **Development test accounts only**. Current work sent no real emails and used no real user accounts.

## Required gates

1. Obtain explicit approval for exact Development test account IDs, two synthetic schools, roles and any fixture writes. Never use an Owner's real account or another real user's account as a test identity.
2. Verify the actual Development API target and startup side effects under a separately approved procedure. Current instruction forbids connecting to an unapproved database, so this verification and an API restart remain blocked. Source-tested activation changes must be safely running before claiming live results.
3. Confirm a provider-documented, tenant-appropriate no-delivery testing mechanism or already-issued approved test tickets. **Clerk Development/test keys do not by themselves guarantee that emails are suppressed.** If signup, verification, password recovery or invitation creation would deliver a real email, stop. Do not click “send invitation” under this permission.
4. Ensure onboarding and notification effects cannot send real emails/SMS or charge payments. Do not configure vendor APIs or operate physical readers/devices.
5. Use separate browser profiles and approved identities. Record role/school/status evidence without recording passwords, secret values, complete invitation tickets, session cookies or signed links. Do not reset Production or bulk-delete fixtures.

## Cases and expected evidence

| Case | Steps and expected result |
| --- | --- |
| Missing ticket | Open acceptance without a ticket. Show “Invitation link incomplete”; no acceptance or role-grant claim. |
| Native invitation, new test identity | Use an approved no-delivery ticket/account. Preserve ticket and artifact base path through signup. Authoritative activation evidence and active intended role/school must precede success. Reload and check the intended portal. |
| Existing Clerk test identity, no app roles | Sign in as the exact approved recipient. Confirm first-read activation is recognized and the role/school matches the approved invitation. |
| Already authorized app identity | Confirm unrelated existing roles do not prove invitation acceptance. For an additional-school/role invitation, require authoritative evidence for that assignment; otherwise record the limitation rather than declaring success. Do not broaden role policy during testing. |
| Wrong account/forwarded ticket | Sign in as a different approved test recipient. Reject or request the correct identity; do not append the invited role or expose the other school's data. |
| Expired/revoked/replaced ticket | Use approved prearranged negative fixtures. Fail clearly without success, duplicate memberships or role escalation. Do not revoke/send real invitations to manufacture fixtures now. |
| Failed authorization read | Simulate a sanctioned 503/transport failure. Stale roles must not produce success. Retry should succeed only after fresh authoritative confirmation, not merely cached access. |
| Partner/internal paths | Use approved no-delivery fixtures. Failed refreshes must not accept stale Partner roles; preserve account/role matching and restricted employee exclusivity. Test identity routing only—no device operations or finance actions. |
| School isolation | With authorized synthetic school A/B fixtures, verify direct protected reads/writes and UI access follow the role matrix. School A identities must not access school B by substituting IDs. Owner remains read-only for ordinary school operations even on a dual-role account. |
| Recipient link/redirect | If separately approved no-delivery message capture is available, inspect the captured template/link without sending email. Confirm the intended Development host, artifact base path and ticket continuity. A working acceptance route alone does not prove the emailed link. |

## Evidence already available

- **42 invitation UI/component tests passed**, including four new cases: missing/inactive permissions despite an activation flag, stale roles on the second read failing, and recovery after a transient error using fresh server-confirmed activation.
- Real route/middleware with mocked identity/persistence: **36 school-isolation tests** and **4 authorized-context activation tests** passed in this continuation.
- School invitation and onboarding regressions passed with mocked provider/persistence operations.
- Public anonymous screenshot rendered the expected incomplete-ticket screen; this is not signed-in acceptance evidence.

No case in this manual plan was executed with genuine accounts/tickets, real delivery or PostgreSQL persistence. Mock evidence does not prove provider delivery, emailed redirect behavior, real SQL constraints or hardware behavior.
