# EduPulse School Management

EduPulse is a multi-tenant school operations platform for Nigerian private schools, covering platform administration, school master data, subscriptions, NFC cards, and audit activity.

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
- EduPulse subscription pricing is server-owned: ₦5,000 total, split into ₦2,000 school share and ₦3,000 EduPulse share.
- Subscription verification activates the subscription and eligible NFC cards; unpaid history remains stored.
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
