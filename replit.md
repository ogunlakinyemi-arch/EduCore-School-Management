# Yetenia EduCore School Management

Yetenia EduCore is a multi-tenant school operations platform from YETENIA TECHNOLOGIES LIMITED (yetenia.com) for Nigerian private schools, covering platform administration, school master data, subscriptions, NFC cards, and audit activity.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/edupulse` — the responsive React/Vite application and product shell.
- `artifacts/api-server/src/routes/edupulse.ts` — API handlers for platform and school operations.
- `lib/api-spec/openapi.yaml` — source of truth for API contracts and generated hooks.
- `lib/db/src/schema/edupulse.ts` — tenant-scoped PostgreSQL schema.
- `artifacts/edupulse/src/index.css` — visual tokens and application theme.

## Architecture decisions

- The app keeps platform-owner views and school operations in the same product shell, with `schoolId` required on tenant-scoped API operations.
- Definitive payment policy: parents pay school fees directly to schools. Separately, the School Admin dashboard initiates exactly ₦3,200 per student per academic term through Flutterwave to the Platform Owner's merchant account. All gross proceeds belong to the Owner; provider processing fees remain separately recorded.
- No active Student split/subaccount checkout, school subaccount settlement, ratio, `transaction_charge`, `transaction_charge_type` or old split release approval is permitted. Existing flags cannot restore these workflows. Historical schemas/records and separately authorized existing-reference reconciliation remain intact.
- Record an independent internal ₦150 BRO entitlement only for a valid eligible association and verified eligible school/student/term payment under Owner-approved policy. Without an eligible BRO, create no record, liability or zero-value ledger row. This is not a provider split or automatic transfer.
- Current-term free use and each school's actual January 2027 second-term rollout remain unchanged. School fee receipts and legacy flags are not proof of current platform payment. Preserve independent NFC/device/approval controls.
- Hosting stays on Replit. Keep server verification, webhook authentication, immutable history, idempotency, reconciliation, school/term eligibility and Owner release gates. App preparation never authorizes secrets changes, Production SQL, real payments, publishing or LIVE enablement. Current policy and blockers: `docs/january-2027-no-split-payment-policy.md`.
- The API contract is OpenAPI-first; generated React Query hooks are the frontend integration boundary.

## Product

The first slice includes a platform dashboard, school management, school overview, students, parents, classes, subscription ledger, NFC card lifecycle, immutable audit log, and settings. Core list/create/update/verify flows persist to PostgreSQL and refresh through generated query hooks.

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Re-run `pnpm --filter @workspace/api-spec run codegen` after editing `lib/api-spec/openapi.yaml`.
- Do not export both `lib/api-zod/src/generated/api` and `lib/api-zod/src/generated/types` from the Zod barrel when Orval emits duplicate parameter names.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
