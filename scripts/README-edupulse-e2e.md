# EduCore development E2E fixtures

These fixtures create **data, not logins**. They do not alter Clerk, grant roles, send invitations, or change any application route. They must not be used with a production database. An existing Platform Owner must sign in normally to invite the test users; each recipient must activate their own account through Clerk.

## Prepare the non-account records

In the Replit **development** workspace only:

```sh
NODE_ENV=development pnpm --filter @workspace/scripts run edupulse:e2e-fixture inspect
NODE_ENV=development EDUCORE_E2E_CONFIRM=create-development-test-records \
  pnpm --filter @workspace/scripts run edupulse:e2e-fixture prepare
```

`prepare` adds only two uniquely coded schools (`E2E-VERIFY-A` and `E2E-VERIFY-B`), one Primary 1 class in each, and two clearly labeled students in each. It checks existing records before inserting, takes a transaction lock, refuses collisions, and is safe to repeat. It does **not** create an Owner, Partner, School Administrator, Parent, Teacher, Staff, or Accountant account.

The command requires `NODE_ENV=development`, a Replit development domain, no deployment marker, a database name matching the development database confirmed during setup (`heliumdb`), and the exact non-secret confirmation shown above. It fails closed if the database target changes; re-check the development and production database targets before updating the guard. This workspace's shell reports `REPLIT_ENVIRONMENT=production` even while its database points at development, so that flag is not used as proof of the target. Do not export the confirmation into a shared or production environment. There is no automatic startup hook.

## Complete identities through the existing app

This workspace already has an Owner membership. The first-owner bootstrap is deliberately one-time and must not be reused. A legitimate Owner must sign in through Clerk, then use the existing Owner interface to:

1. Invite one controlled School Administrator to each fixture school, using addresses from a mailbox the tester can actually access. Accept each invitation through Clerk and verify each Admin belongs only to their assigned school.
2. Invite **two different** controlled Partners through the existing Partner invitation flow. Accept both invitations through Clerk before treating Partner A/B as authenticated test identities. Each Partner should generate their own referral link and register a different additional test school through that link; do not insert a fabricated referral relationship into the database.
3. Use each School Administrator account to invite controlled school users through the existing School User invitation flow: Teacher, Accountant, Staff, and Parent. Accept each invitation through Clerk. Parent invitations require a phone number. Do not send invitations to arbitrary addresses or import a mailing list.
4. If a separate test Owner is needed, the existing Owner can grant the platform role to an **already authenticated** controlled account through the authorized Owner flow. Do not grant it directly in this fixture or use the first-owner bootstrap again.

No controlled receiving mailbox or login credentials are configured in this project. Until one is available, **do not claim** invitation delivery, activation, or an authenticated browser pass. Do not place credentials in files, commands, logs, or chat.

## Link verified parents to the fixture children

Only **after** each parent has accepted the invitation, signed in, and has an active Parent membership/profile in the correct school, run:

```sh
NODE_ENV=development EDUCORE_E2E_CONFIRM=link-development-test-parents \
  EDUCORE_E2E_PARENT_A_EMAIL="<controlled-parent-a-email>" \
  EDUCORE_E2E_PARENT_B_EMAIL="<controlled-parent-b-email>" \
  pnpm --filter @workspace/scripts run edupulse:e2e-fixture link-parents
```

Use only controlled addresses; the Parent B address is optional. The script refuses unactivated or wrong-school profiles, preserves existing relationships, and associates Parent A with both School A fixture children. These are non-secret environment values, not passwords. Avoid putting personal addresses into shell history if they are sensitive; use the workspace's development environment-variable form instead.

Run `inspect` again to see counts without printing any email addresses. Use the actual signed-in browser and `/api/auth/me/authorized-context` to confirm identity and school/Partner context. A database membership or a successful `inspect` is **not** proof of browser authentication.

## E2E checklist once identities and mailbox exist

Use a real Clerk session for each role, including Partner A and Partner B, and record the actual response codes:

- Owner: dashboard, both schools, Partner directory, NFC management, audit; no exposed credentials.
- Admin A/B: own dashboard and students; direct URL and API attempts against the other school's students, parents, staff, attendance, imports, and finance must fail.
- Partner A/B: generate distinct referral links; onboard separate schools through the links; own summaries and commissions load; the other Partner's resources and private school records are denied.
- Parent A: see both fixture children, not School B's children or unrelated records.
- Teacher/Staff: only their assigned school and authorized features.
- Invitation: observe the message in the controlled inbox, open it, activate, sign in, and test invalid/reused links.
- Import: use controlled CSV/XLSX/PDF files, preview first, confirm only deliberate test rows, then test cross-school IDs and duplicate cases.

Do not resume Phase 7 Finance as part of fixture setup. Imported-parent/personnel invitation policy and cross-school parent-account support are separate product decisions.