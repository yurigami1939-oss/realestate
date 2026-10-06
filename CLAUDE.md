# CLAUDE.md — <PRODUCT_NAME>

> Permanent source of truth for every session. Read it fully before working.
> Update **§11 Roadmap** at the end of every session and **§12 Decisions log** whenever a decision is taken.
> Next.js 16 docs ship in `node_modules/next/dist/docs/` — check them before using a Next API (AGENTS.md is managed by `next dev`).

---

## 1. Product overview

- B2B **multi-tenant SaaS** for **Algerian real-estate developers** (promoteurs immobiliers, usually SARL), their sales agents, and later their residents.
- **Half 1 — Promotion sales**: projects → buildings → units inventory, sales CRM, option → reservation → VSP (vente sur plans), payment schedules, payment calls, receipts, construction progress, handover.
- **Half 2 — Residence management** (after delivery): co-owners/occupants, budgets, charge calls with distribution keys, suppliers, staff, tickets, general assemblies.
- **Portal** for buyers/residents: own schedule, payments, documents, construction progress, charges, tickets.
- One **organization = one tenant** (one promoter). Single Postgres database, row-level isolation.
- UI in **French (default)** and **Arabic (RTL)**. Currency **DZD**. Timezone **Africa/Algiers**.
- Legal context (verify before encoding any legal rule): VSP/reservation governed by **Loi 11-04 (17/02/2011)** and **décret exécutif 13-431** (model contracts, VSP payment limits, delay penalties); personal data under **Loi 18-07** (ANPDP).

## 2. Tech stack

Exact versions are pinned in `package.json` (`.npmrc`: `save-exact`, `engine-strict`). Keep this table in sync.

| Area | Package / tool | Version |
|---|---|---|
| Runtime | Node.js (`engines >=22.12`) · pnpm | 22 LTS · 10.32.1 |
| Framework | `next` (App Router, Turbopack) · `react` · `react-dom` | 16.3.7 · 19.2.8 · 19.2.8 |
| Language | `typescript` (`strict`, `noUncheckedIndexedAccess`) | **6.0.3** (not 7.x, see §12) |
| Database | PostgreSQL, Docker `postgres:18.6-alpine` (host port **5433**) | 18 |
| ORM | `drizzle-orm` · `drizzle-kit` · `pg` | 0.45.3 · 0.31.11 · 8.23.0 |
| Auth | `better-auth` + `organization` plugin (schema via CLI `auth@1.7.6`) | 1.7.6 |
| Validation | `zod` | 4.6.5 |
| UI | `tailwindcss` · shadcn/ui CLI `shadcn` (radix-nova, RTL) · `radix-ui` · `lucide-react` · `sonner` | 4.3.3 · 4.21.0 · 1.6.7 · 1.49.0 · 2.0.8 |
| Forms | `react-hook-form` · `@hookform/resolvers` | 7.89.0 · 5.9.1 |
| Data grids | `@tanstack/react-table` (v9 API: `useTable`, `tableFeatures`) | 9.2.4 |
| i18n | `next-intl` | 4.14.8 |
| Jobs | `pg-boss` | 12.35.0 |
| PDF | HTML templates → **headless Chromium** via `playwright-core` | 1.63.0 |
| Files | `@aws-sdk/client-s3` · `@aws-sdk/s3-request-presigner` · SeaweedFS (local S3) | 3.1143.0 · `chrislusf/seaweedfs:4.48` |
| Email | `nodemailer` · Mailpit (local SMTP catcher) | 10.0.13 · `axllent/mailpit:v1.31` |
| Dates | `date-fns` · `@date-fns/tz` (schedules, Phase 1) | 4.4.0 · 1.5.0 |
| Phones | `libphonenumber-js` (default "min" metadata) | 1.13.14 |
| Spreadsheets | `write-excel-file` (exports) · `read-excel-file` (imports), .xlsx, server side | 4.1.1 · 9.3.10 |
| Font | IBM Plex Sans Arabic (OFL, Arabic + Latin), `src/assets/fonts/` | 1.101 |
| Tests | `vitest` · `@playwright/test` | 5.0.3 · 1.63.0 |
| Tooling | `eslint` + `eslint-config-next` (flat) · `prettier` + `prettier-plugin-tailwindcss` · `tsx` | 9.39.5 + 16.3.7 · 3.9.9 + 0.8.1 · 4.23.15 |

Adding a runtime dependency = one line in §12.

## 3. Commands

First run: `pnpm install` · `cp .env.example .env` · `pnpm docker:up` · `pnpm exec playwright install chromium` · `pnpm db:reset` · then `pnpm dev` and `pnpm worker`. Demo accounts: `src/db/seed/demo.ts`.

| Command | Does |
|---|---|
| `pnpm docker:up` / `pnpm docker:down` | Start (and wait for) Postgres (dev, test, e2e DBs), SeaweedFS + bucket, Mailpit / stop them |
| `pnpm dev` | Next dev server → http://localhost:3000 (Mailpit UI → http://localhost:8025) |
| `pnpm worker` | pg-boss worker (separate process; emails and all jobs need it) |
| `pnpm build` · `pnpm start` | Production build · serve |
| `pnpm lint` | ESLint + RTL class check + invisible/bidi character check |
| `pnpm typecheck` | `next typegen` + `tsc --noEmit` |
| `pnpm format` | Prettier write |
| `pnpm test` · `pnpm test:watch` | Vitest unit + integration against `realestate_test` (needs `docker:up` + Chromium) |
| `pnpm e2e` | Playwright: builds, serves on :3100, resets + seeds `realestate_e2e`, runs a job worker |
| `pnpm db:generate` | drizzle-kit: SQL migration from `src/db/schema` |
| `pnpm db:migrate` | Migrations (owner) + `post-migrate.sql` (RLS, grants) + pg-boss schema and queues |
| `pnpm db:seed` | Wipe local data and seed the demo promoter (refuses non-local DBs) |
| `pnpm db:reset` | Drop all schemas, migrate, seed (local only) |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm auth:generate` | Regenerate `src/db/schema/auth.ts` after changing `src/server/auth/schema-options.ts` |
| `pnpm check` | lint + typecheck + test — the CI gate; must be green before a step is "done" |

## 4. Repository structure

```
.
├── CLAUDE.md · AGENTS.md     # this file · Next.js agent notes (managed by `next dev`)
├── docker-compose.yml        # postgres:18 (:5433), seaweedfs (:8333), mailpit (:1025/:8025)
├── docker/                   # init SQL (roles, dev/test/e2e DBs), SeaweedFS S3 identities
├── drizzle.config.ts         # drizzle-kit config (owner connection, snake_case)
├── playwright.config.ts      # e2e: production build on :3100, realestate_e2e
├── vitest.config.ts          # unit + integration, realestate_test, server-only stub
├── messages/                 # next-intl catalogs fr.json / ar.json (identical keys, tested)
├── scripts/                  # db-migrate/seed/reset, storage-init, rtl-lint, check-source-chars,
│                             # auth schema generation, shims/server-only.mjs, swc-native-cache.ts
├── e2e/                      # Playwright specs, helpers, auth.setup (one saved session per role),
│                             # env, global setup (bucket + db reset)
├── tests/                    # Vitest global setup, env, factories, Better Auth helpers
├── .github/workflows/ci.yml  # check job + e2e job
└── src/
    ├── proxy.ts              # Next 16 proxy (ex-middleware): locale routing only
    ├── env.ts                # zod-validated server env (fails at import)
    ├── assets/fonts/         # IBM Plex Sans Arabic TTF + OFL (UI and PDFs)
    ├── app/
    │   ├── [locale]/
    │   │   ├── (auth)/       # sign-in, sign-up, forgot/reset password, onboarding, accept-invitation
    │   │   ├── (app)/        # back-office shell (guard + sidebar) · dashboard · settings (members,
    │   │   │                 # company + logo, audit log) · projects · construction · leads · buyers · sales
    │   │   │                 # · commissions · deliveries · rentals · residences · online-payments
    │   │   │                 # · settings/online-payment (SATIM account) · whatsapp (message log)
    │   │   │                 # · settings/whatsapp (number, webhook, templates) · exports (Excel exports)
    │   │   │                 # · imports (reprise de données: templates, check, import)
    │   │   │                 # · treasury (cash desks and accounts, ledgers, cash counts)
    │   │   │                 # · projects/[id]/costs (budget, contracts, progress invoices, margin, forecast)
    │   │   │                 # · reports (sales, commercials, receivables by age, expected collections, stock)
    │   │   └── (portal)/     # portal of buyers, co-owners and occupants (module 7): own shell, /portal,
    │   │                     # /portal/payments (online payment results), /portal/payment-terms
    │   ├── api/auth/[...all] # Better Auth handler (Route Handlers: auth, files, webhooks, /api/v1)
    │   ├── api/files/        # upload (POST) · [fileId] download (GET → presigned redirect)
    │   ├── api/online-payments/return # where SATIM sends the payer back (confirm, then result page)
    │   ├── api/exports/[kind] # .xlsx exports (GET, the list's filters, `locale`)
    │   ├── api/imports/[kind] # data import (POST .xlsx: check or commit) · [kind]/template (GET)
    │   ├── api/dev/          # local stand-ins (DEV_GATEWAYS only): satim/[...path] (SATIM REST + page),
    │   │                     # whatsapp/[...path] (Cloud API)
    │   ├── api/webhooks/whatsapp/[orgId] # Meta's webhook: verification, delivery statuses, « STOP »
    │   └── fonts.ts          # next/font/local for the shared font
    ├── components/
    │   ├── ui/               # shadcn/ui primitives (generated; sidebar labels made translatable)
    │   ├── app-shell/        # sidebar, org switcher, user menu
    │   ├── forms/            # TextField, fields, FormDialog, ConfirmAction, useAction, useTranslateKey
    │   ├── files/            # UploadButton (posts to /api/files)
    │   ├── data-table/       # DataTable (TanStack columns), Pagination (links), useSearchParamsState
    │   ├── crm/              # stage/visit badges, phone text + call/WhatsApp, follow-up/visit dialogs
    │   ├── inventory/        # unit/project status badges, stats bar, floor labels
    │   ├── sales/            # sale/installment badges, option dialogs, DocumentPdf (+ refresher), VSP warnings
    │   ├── construction/     # building progress bars, report dialog and card, site photos, milestone validation
    │   ├── handovers/        # delivery state badges, filters, appointment / reserve / PV dialogs, PV links
    │   ├── rentals/          # lease form (schedule preview), payment / end / renewal / deposit / inspection
    │   │                     # dialogs, badges, PDF links
    │   ├── online-payments/  # « Payer en ligne » dialog, status / test / cards badges, result page actions,
    │   │                     # staff filters, re-check and refund
    │   ├── whatsapp/         # message status badge, log filters
    │   ├── exports/          # ExportButton (« Exporter (Excel) » on the lists), the exports page's forms
    │   ├── imports/          # ImportPanel (template, file, check, import, report of issues)
    │   ├── certificates/     # IssueCertificateDialog (sale page), PortalStatementButton (portal)
    │   ├── obligations/      # ProjectDocuments (regulatory file), its dialog, DocumentScan
    │   ├── treasury/         # account / movement / cash count dialogs, AccountField (« Encaissé sur »), ledger filters
    │   ├── costs/            # budget dialog, contract / progress invoice / payment / acceptance / retention dialogs
    │   ├── reports/          # ReportFilters (period, project)
    │   ├── residences/ · staff/ · suppliers/ · tickets/ · assemblies/ · announcements/  # residence
    │   │                     # module: dialogs, ChargeDocumentPdf, attendance grid, payroll, attendance
    │   │                     # sheet, vote grid
    │   └── auth/ · i18n/     # sign-out, locale switcher
    ├── db/
    │   ├── schema/           # auth.ts (GENERATED) · platform.ts · _columns.ts helpers · index.ts
    │   ├── migrations/       # drizzle-kit SQL (never hand-edit applied files)
    │   ├── sql/post-migrate.sql # RLS on every organization_id table, grants, revokes
    │   ├── seed/             # demo.ts (users, SARLs), inventory.ts (118 units), crm.ts (25 leads,
    │   │                     # visits, follow-ups, targets), sales.ts (plans, quotations), reservations.ts
    │   │                     # (settings, buyers, sales, payments, VSP, loan, calls, letter), residences.ts
    │   │                     # (delivered « Résidence El Yasmine »: units delivered before the app, co-owners,
    │   │                     # charges, calls, payments, suppliers, staff, tickets, assemblies, announcements),
    │   │                     # portal.ts (the demo resident account linked to its own sale and co-owner record),
    │   │                     # deliveries.ts (« Résidence Les Amandiers »: sold units, handovers, reserves, PVs),
    │   │                     # construction.ts (progress reports; photos.ts draws the site photos), rentals.ts
    │   │                     # (leases of the kept shop and two flats: payments, états des lieux, an ended lease
    │   │                     # with its deposit settled), online-payments.ts (the SATIM account on the test
    │   │                     # platform), whatsapp.ts (the WhatsApp number, every notification on); grows per
    │   │                     # module
    │   ├── client.ts         # pg Pool + drizzle (app role)
    │   ├── tenant.ts         # withTenant(scope, fn, tx?)
    │   └── migrate.ts        # migrateDatabase(): migrations + post-migrate + pg-boss
    ├── server/
    │   ├── action.ts         # defineAction()
    │   ├── auth/             # auth.ts (Better Auth), session.ts (getSession, getTenantCtx, assertCan),
    │   │                     # page-guard.ts (requireTenantCtx, requirePermission), schemas.ts, schema-options.ts
    │   ├── audit/            # recordAudit(); queries.ts (audit log viewer, record links)
    │   ├── dashboard/        # getDashboard(): role-dependent sections (to-do, sales, collections, stock, CRM)
    │   ├── numbering/        # nextDocumentNumber()
    │   ├── email/            # transport, send-later (queue), bilingual templates
    │   ├── files/            # s3.ts (client, ensureBucket), storage.ts (keys, put, presign),
    │   │                     # service.ts (checkUpload, storeFile, discardFile, getFileDownloadUrl)
    │   ├── route-handler.ts  # jsonResult, assertSameOrigin, readFormData (size-capped)
    │   ├── organizations/    # members & invitations; settings.ts (legal identity, sales settings, logo,
    │   │                     # loadCompanyLetterhead for documents)
    │   ├── inventory/        # projects, buildings, units, price lists, floor plans, transitionUnit
    │   ├── crm/              # leads, visits, follow-ups, merge, targets; access.ts (lead visibility)
    │   ├── payment-plans/    # construction milestones (planned, stage) and payment plan templates
    │   ├── construction/     # construction follow-up: progress reports, building progress, site photos
    │   ├── rentals/          # leases and états des lieux (service.ts), derived rent account (accounts.ts),
    │   │                     # quittances and inspection reports (documents.ts), overdue rents, digest.ts
    │   ├── handovers/        # deliveries: appointments, reserves, PV de remise des clés (unit delivered),
    │   │                     # PV de levée des réserves (documents.ts), units delivered before the app
    │   ├── quotations/       # issue/cancel, queries, pdf.ts (job: render + store once)
    │   ├── buyers/           # buyer files, documents checklist; access.ts (buyer visibility)
    │   ├── sales/            # options, reservations + VSP (reservations.ts), sale queries, withdrawals,
    │   │                     # transfers + unit swaps (changes.ts), bank loans, documents; access.ts
    │   ├── payments/         # payments + receipts (record, cancel, clear cheque), receipt PDF
    │   ├── online-payments/  # SATIM card payments: satim.ts (REST client), satim-standin.ts (local stand-in),
    │   │                     # gateway.ts (account, base URLs), service.ts (start, confirm, check, refund,
    │   │                     # settings), queries.ts, portal-actions.ts
    │   ├── payment-calls/    # milestone validation, appels de fonds (job + PDF)
    │   ├── collections/      # derived overdue, reminder letters (PDF), daily digest (jobs)
    │   ├── commissions/      # list, mark paid, rates per commercial
    │   ├── residences/       # residences, tantièmes (shares, area split), co-owners and occupants
    │   ├── charges/          # categories, budgets, charge periods and calls (ADC), payments and
    │   │                     # receipts (RCH), unit accounts (accounts.ts: derived statement), overdue
    │   │                     # charges, reminder letters and digest (collections.ts), budget vs actual
    │   │                     # and reserve fund (report.ts), PDFs
    │   ├── suppliers/        # suppliers (per organization), contracts per residence, invoices (invoices.ts)
    │   ├── staff/            # residence agents (role, net salary, charge category), salary advances,
    │   │                     # monthly attendance (attendance.ts), monthly pay (pay.ts)
    │   ├── tickets/          # réclamations: workflow, assignment (agent or supplier), history
    │   ├── assemblies/       # general assemblies: agenda, convening, attendance and proxies, votes,
    │   │                     # closing (frozen results), convocation and minutes PDFs (documents.ts)
    │   ├── announcements/    # residence announcements: drafts, publication (printable notice), withdrawal
    │   ├── portal/           # portal access (invitations.ts, link.ts), context.ts (getPortalCtx, portalScope),
    │   │                     # page-guard.ts (requirePortalCtx), action.ts (definePortalAction), queries.ts
    │   │                     # (home), sales.ts (a buyer's sale), residences.ts (charges account, announcements,
    │   │                     # tickets, assemblies), files.ts (which stored files a portal account may download)
    │   ├── documents/        # render.ts: `pdf.document` dispatcher (one renderer per kind)
    │   ├── whatsapp/         # cloud-api.ts (send a template, webhook signature and payload), standin.ts,
    │   │                     # account.ts (account, API URL, template per kind), notify.ts (queue a message
    │   │                     # per event: the business services call it), service.ts (settings, send job,
    │   │                     # webhook, residents' consent), queries.ts
    │   ├── exports/          # xlsx.ts (typed workbook), builders.ts (one per export), service.ts
    │   │                     # (buildExport: filters, rights, audit), schemas.ts (kinds, filters, links)
    │   ├── imports/          # sheets.ts (read .xlsx, FR/AR headers, cell converters), plan.ts (ImportPlan,
    │   │                     # issues), units · buyers · sales · residents (one prepare* each: checks,
    │   │                     # then the writes), templates.ts, service.ts (runImport: commit, audit)
    │   ├── certificates/     # snapshot.ts (what a certificate prints, frozen), service.ts (issue; the
    │   │                     # portal statement), queries.ts, documents.ts (PDF job), actions
    │   ├── obligations/      # the promoter's obligations: regulatory file of a project (service, queries,
    │   │                     # dashboard alerts), late deliveries
    │   ├── treasury/         # cash desks and bank / CCP accounts: service.ts (accounts, movements, cash counts,
    │   │                     # resolvePaymentAccount), balances.ts (balances from every flow), queries.ts (ledger)
    │   ├── costs/            # construction costs: service.ts (budget, contractors, contracts, progress invoices,
    │   │                     # acceptances, retention), queries.ts (costs by category, margin, cash-flow forecast)
    │   ├── reports/          # getReports: management reports over a period (sales, commercials, ageing, stock)
    │   ├── secrets.ts        # encryptSecret / decryptSecret (AES-256-GCM, SECRETS_KEY): organization secrets
    │   ├── stand-ins.ts      # devGatewaysEnabled, standInUrl (the /api/dev/* stand-ins)
    │   └── <module>/         # schemas.ts (isomorphic) · queries.ts · service.ts · actions.ts · *.test.ts
    ├── jobs/                 # queues.ts (names, retry policy, payload types), enqueue.ts, worker.ts, handlers/
    ├── pdf/                  # render.ts (Chromium), document.tsx (shell + fonts), receipt.ts, quotation.ts,
    │                         # payment-methods.ts (method labels on receipts),
    │                         # templates/ (letterhead, quotation, receipt, reservation-sheet, payment-call,
    │                         # reminder-letter, charge-call, charge-reminder, assembly-convocation,
    │                         # assembly-minutes, announcement-notice, handover-pv, handover-release,
    │                         # certificate)
    ├── i18n/                 # locales, routing, navigation, request config, typed messages
    ├── hooks/                # client hooks (use-mobile)
    └── lib/                  # isomorphic: result, permissions, money/, dates, document-types, safe-next, auth-client,
                              # inventory, crm (stages), phone, payment-plans (buildSchedule, VSP limits, milestone
                              # due date), statement (FIFO allocation, overdue, penalties), sales, quotations, files, zod, ids,
                              # residences (frequencies, keys), charges (period parts, splits, period names),
                              # assemblies (majorities, vote tallies), announcements (categories, state),
                              # online-payments (statuses, 50 DA minimum, amount offered), whatsapp (kinds,
                              # template texts, WhatsApp numbers, « STOP »), certificates (kinds, snapshot), obligations
                              # (regulatory documents, delivery delay and indemnity, warranties), treasury (account kinds per
                              # payment method, running balance), costs (categories, retention split, spread, margin), reports (ageing buckets, months)
```

## 5. Architecture rules

### Multi-tenancy
- Tenant = Better Auth `organization`. Every tenant-owned table has `organization_id uuid not null` (helper `organizationId()` in `_columns.ts`), leading column of its composite indexes/uniques.
- **RLS is automatic**: `post-migrate.sql` runs after every migration and, for every `public` table with an `organization_id` column, enables + **forces** RLS and creates policy `tenant_isolation`:
  `organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid` (USING and WITH CHECK). Unset → zero rows.
- Exempt (scoped by Better Auth itself): `member`, `invitation`. Other Better Auth tables have no `organization_id`.
- **Two DB roles**: `realestate_owner` (owns schema; migrations, seed wipes) and `realestate_app` (runtime; `NOSUPERUSER NOBYPASSRLS`, DML grants only). Other environments must provision the same role names.
- `withTenant(scope, fn, tx?)` opens a transaction with `set_config('app.current_org', orgId, true)` (tx-local, pool-safe); pass `tx` to join an open tenant transaction. Every tenant read/write goes through it.
- Catalog test (`tests/rls.test.ts`) fails CI if a tenant table lacks forced RLS + policy, or if the app role can bypass RLS.
- `organization_id` comes from the session, never from client input. Portal users (`resident`) are additionally filtered by their linked record in services.

### Data access
- `src/server/<module>/queries.ts` (reads) and `service.ts` (mutations + rules) take `ctx: TenantCtx` first and start with `import 'server-only'`.
- ESLint `no-restricted-imports`: `@/db/*`, `drizzle-orm`, `pg`, `pg-boss` only in `src/db`, `src/server`, `src/jobs`, `scripts`, `tests`, `e2e`.
- Server Components call queries directly and get their context with **`requireTenantCtx()`** (`page-guard.ts`), which redirects instead of throwing (pages render in parallel with the layout guard); **`requirePermission(permission)`** adds the check and answers 404 when it fails.
- One transaction = one connection: inside `withTenant`, `await` queries one after another (no `Promise.all` on `tx`; pg deprecates concurrent queries on a client).
- Tenant child → parent foreign keys are **composite** `(organization_id, parent_id)` → `(organization_id, id)` with explicit short names (`unit_building_fk`): FK checks bypass RLS, so this is what stops a row from pointing into another tenant.
- `schemas.ts` files are isomorphic (shared with client forms): no server-only imports.
- **Lead visibility** (CRM): a commercial sees the leads assigned to them, managers (`lead:read_all`) all. Every CRM read/write goes through `visibleLeads(ctx)` / `loadVisibleLead()` (`src/server/crm/access.ts`); visits, follow-ups, quotations and their PDFs follow their lead. Invisible = `NOT_FOUND`.
- **Sale visibility**: a commercial sees the sales credited to them (`reservation.commercial_user_id`, the lead's owner at reservation), managers, cashiers and accountants (`sale:read_all`) all: `visibleSales(ctx)` / `loadVisibleReservation()` (`src/server/sales/access.ts`). Payments, receipts, payment calls, reminder letters, withdrawals, loans and their PDFs follow their sale. Buyers: `visibleBuyers` / `loadVisibleBuyer` (`buyer.owner_user_id`; `buyer:read_all` for managers, cashiers, accountants).
- Detail queries return `null`/not-found for a non-UUID route id (`isUuid`) instead of reaching Postgres.

### Mutations
- Server Actions in `src/server/<module>/actions.ts` (`'use server'`), each `defineAction({ input, permission }, handler)`: zod parse → `getTenantCtx()` → `assertCan` → handler → `Result<T>`. Never throws to the client except Next control flow. Handlers call services, then `revalidatePath`.
- Client components run actions with `useAction(action)` (translated error toasts).
- Route Handlers only for: Better Auth (`/api/auth/[...all]`), file upload/download (`/api/files`), spreadsheet exports and imports (`/api/exports/[kind]`, `/api/imports/[kind]`), the payment gateway's return (`/api/online-payments/return`), the WhatsApp webhook (`/api/webhooks/whatsapp/[orgId]`), the local stand-ins of external services (`/api/dev/*`, DEV_GATEWAYS only), future mobile API (`/api/v1/*`). They answer the same `Result<T>` JSON via `jsonResult()` (HTTP status from the error code) and call services exactly like actions.

### Auth & roles
- Better Auth: email + password, password reset, organization plugin, invitations by email (7 days). `session.activeOrganizationId` = current tenant; new sessions land in the user's first organization (database hook); the org switcher changes it.
- Better Auth IDs are random UUID v4 (`generateId: "uuid"`: unguessable invitation links); domain tables use `uuidv7()`.
- Schema-affecting options live in `src/server/auth/schema-options.ts`; `pnpm auth:generate` regenerates `src/db/schema/auth.ts` (timestamps post-processed to `timestamptz`).
- Roles and permissions: `src/lib/permissions.ts` (Better Auth access control). A member may hold several roles (`"accountant,cashier"`). Permissions are `resource:action`; each module adds its resources there.
- `getTenantCtx()` → `{ userId, orgId, roles, locale }`. `assertCan(ctx, 'member:update')` **in services**; the UI uses `can()` only to hide controls.
- Member management (invite, cancel, change roles, remove) goes through `src/server/organizations/service.ts`: our permission check + owner protection, Better Auth performs the change, then `recordAudit` with the acting user. Joining and organization creation are audited by Better Auth hooks. The members page only grants staff roles (`staffRoles`: every role but `owner` and `resident`), in its invitation form, its role menu and `memberRolesSchema` (`validation.staffRole`): the portal role comes only from a portal invitation.
- `proxy.ts` does locale routing only; `(app)/layout.tsx` redirects to `/sign-in` or `/onboarding`.
- Post-login redirects go through `safeNext()` (same-site paths only).
- **Portal accounts** (module 7): a member whose only role is `resident` (`isPortalOnly`). They see the `(portal)` shell only: `requireTenantCtx()` and the back-office layout redirect them to `/portal`, the portal layout sends staff back to `/dashboard`. Portal pages use `requirePortalCtx()` → `PortalCtx { userId, orgId, name, locale }`; every portal query starts from `portalScope(tx, ctx)` (the account's live `portal_link` rows: buyer files, co-owners / occupants still current) and never takes a record id from the client without checking it belongs to that scope. Staff lists (`listMembers`, `listPendingInvitations`) leave portal accounts and invitations out. Downloads: `/api/files` checks a portal account with `portalCanRead` (`src/server/portal/files.ts`) instead of the staff readers — the files of its own sales (entity `reservation` of a sale its buyer files take part in) and, under entity `residence`, its co-owned units' charge calls, receipts and reminder letters, its co-owned residences' convocations and PVs, and published notices of its residences; the site photos of the published progress reports of the projects it bought in (entity `construction_report`); the delivery PVs of its sales (entity `handover`). Portal mutations use `definePortalAction` (portal context, never a staff one).
- **Portal invitations** (`portal:invite`: gérant, directeur commercial, gestionnaire; `buyer:update` for a buyer file, `residence:update` for a co-owner / occupant): `inviteToPortal` inserts a Better Auth `invitation` row (role `resident`, 7 days) itself — staff below the gérant have no Better Auth `invitation:create` — and e-mails it bilingually; the existing accept-invitation page accepts it and the `afterAcceptInvitation` hook (`linkPortalAccount`) gives the account every record waiting on its e-mail. An e-mail already used by a portal account of the organization is linked at once; a staff member's e-mail is refused. One live link per record; withdrawing it (`revokePortalLink`) keeps the row (revoked) and cancels an invitation nobody else waits on. Audited `portal.invite` / `portal.revoke`.

| Role | FR | Scope today (extended per module) |
|---|---|---|
| `owner` | Gérant | Everything: organization, members, invitations, audit; approves withdrawals, sets commission rates; created with the organization, cannot be changed or removed |
| `sales_manager` | Directeur commercial | CRM & sales, price lists, lead assignment, discounts, targets; reservations, VSP, contracts, transfers, unit swaps, bank loans, milestone validation, withdrawal proposals, reminder letters, certificates; construction follow-up (read), deliveries, leases |
| `sales_agent` | Commercial | Own leads/visits/quotations; buyer files, options and reservations of own leads; own sales and commissions (read) |
| `accountant` | Comptable | Audit read; all sales (read), payments (record, cancel), withdrawal refunds, reminder letters, certificates, commissions (mark paid); leases (read) |
| `cashier` | Caissier | All sales (read); record payments (receipts), clear cheques, withdrawal refunds, reminder letters, certificates; leases (read), rent payments |
| `technical_manager` | Responsable technique | Module 4: construction follow-up (progress reports, photos) and deliveries; contractors' contracts and progress invoices (not their payment); projects read-only; no sales or buyer files |
| `property_manager` | Gestionnaire de résidence | Phase 2: residence module; construction follow-up and deliveries (read); leases |
| `resident` | Acquéreur / résident | Portal only (module 7): the records linked to the account by invitation (`portal_link`) |

The WhatsApp message log (`notification:read`) is open to the gérant, the directeur commercial, the comptable, the caissier and the gestionnaire; the SATIM account and the WhatsApp number are the gérant's (`organization:update`).

### Jobs (pg-boss)
- Schema `pgboss` is owned by the app role; `db:migrate` creates it and creates/updates every queue declared in `src/jobs/queues.ts` (name, retry policy, payload type).
- Worker = separate process (`pnpm worker`), graceful shutdown. Next.js only calls `enqueue()` (send-only instance).
- Tenant jobs carry `organizationId` and run inside `withTenant`; platform jobs (auth emails) do not. Handlers are idempotent. Money in payloads = decimal string of centimes.
- A job that follows a business write is enqueued **in the same transaction** with `enqueueInTx(tx, …)` (pg-boss `fromDrizzle`): it exists only if the write commits. `singletonKey` = the record id — on standard queues pg-boss only deduplicates **throttled** jobs (`singletonSeconds`), so handlers must be idempotent; once-a-day jobs use `singletonSeconds: 86_400`.
- Queues today: `email.send`; `pdf.document` (`{ organizationId, kind, id }`, kinds `quotation`, `reservation_sheet`, `receipt`, `payment_call`, `reminder_letter`, `charge_call`, `charge_receipt`, `charge_reminder`, `assembly_convocation`, `assembly_minutes`, `announcement`, `handover_pv`, `handover_release`, `rent_receipt`, `lease_inspection`, `certificate`: one renderer per kind in `src/server/documents/render.ts`, each renders once and links the stored file; a running worker must be restarted to know a new kind); `option.expire` (scheduled at the option's expiry); `payment_call.issue` (after a milestone validation); `reminders.daily` (cron 08:00 Africa/Algiers, declared in `schedules` in `queues.ts` and installed by `db:migrate`) → one `reminders.digest` per organization, which sends the overdue sales digest, the overdue charges digest and the rentals digest (overdue rents, leases ending within 30 days); `online_payment.check` (30 minutes after an online payment starts: settles it with SATIM if the payer never came back; retried every 10 minutes while SATIM has it in progress); `whatsapp.send` (one WhatsApp message, queued in the transaction of the event it reports; retried while Meta is unreachable or throttling, then failed).
- `db:migrate` starts pg-boss once with the scheduler on so its internal cron queue exists before any worker (see §12). Stop dev workers by killing the node process tree (Windows keeps children of a stopped shell).

### Email
- Always queued (`sendEmailLater`, or `enqueueInTx` from a job); the worker sends with nodemailer. Auth and staff emails are **bilingual** (French then Arabic) because the recipient's language is unknown (auth emails; the daily overdue digest). Templates in `src/server/email/templates.ts`, texts in the catalogs (`emails.*`), values HTML-escaped.

### Files
- S3 API only. Local: SeaweedFS (bucket created by `docker:up`). Production: any S3-compatible provider (location TBD, §12).
- Private bucket. Key: `org/{orgId}/{entityType}/{entityId}/{fileId}.{ext}`; a tenant-scoped `file` row holds metadata (`entity_type` + `entity_id` = owner record).
- **Upload**: `POST /api/files` (multipart `purpose`, `entityId`, `file`) → `Result<{ fileId }>`. Same-origin check, body capped while streaming (`readFormData`), then a switch on `purpose` calls the owning service (e.g. `setUnitFloorPlan`), which asserts the permission, runs `checkUpload` (size + **magic-byte** format check against `uploadPurposes` in `src/lib/files.ts`; the browser's MIME type is ignored) and `storeFile(tx, …)` (row insert, then S3 put, inside the tenant transaction). Client: `UploadButton`.
- **Download**: `GET /api/files/{id}[?download]` → access check by `entity_type` (`readers` in `src/server/files/service.ts`: a unit plan needs `inventory:read`, a quotation PDF needs its lead to be visible, a buyer document its buyer, a sale's files its sale) → 302 to a 5-min presigned URL with the original name (`Content-Disposition` with UTF-8 `filename*`).
- Upload purposes today: `unit.floor_plan`, `buyer.document` (variant = document kind), `reservation.contract`, `reservation.deed`, `organization.logo` (PNG/JPEG only, 2 MB; readable by any member of the organization), `construction_report.photo` (JPEG/PNG/WebP, 10 MB, up to 20 per report; entity `construction_report`, readers `construction:read`), `lease.contract` (signed lease scan), `supplier_contract.scan` and `supplier_invoice.scan` (a supplier contract's and an invoice's scan, paid or not; entities `supplier_contract` / `supplier_invoice`, readers `supplier:read`), `reservation.guarantee` (the FGCMPI guarantee certificate, under the sale), `project_document.scan` (a regulatory document; entity `project_document`, readers `inventory:read`), `works_contract.scan` and `works_invoice.scan` (a contractor's contract and progress invoices, entity `works_contract`, readers `cost:read`). Every document of a sale (reservation sheet, receipts, payment calls, reminder letters, certificates, signed scans) is filed under entity `reservation`, so its readers follow the sale's visibility. Residence documents (charge calls, receipts and reminders, assembly convocations and minutes, announcement notices) are filed under entity `residence`; readers need `charge:read`, `assembly:read` or `announcement:read`. Delivery PVs (remise des clés, levée des réserves) are filed under entity `handover`: readers with `handover:read`, or who see the sale. Lease documents (quittances, deposit receipts, états des lieux, signed lease scans) are filed under entity `lease`: readers with `lease:read`.
- Replacing/removing a file soft-deletes the old row (`deleted_at`); the object stays in the bucket. New purpose = entry in `uploadPurposes` + service function + `case` in `src/app/api/files/route.ts` (+ a `readers` entry for a new entity type). Generated documents are stored with `storeFile(tx, { orgId, userId: null }, …)` by their job.
- Issued documents are rendered once at issue; the stored PDF is served for reprints.

### PDF
- Documents are React components rendered to static HTML (`src/pdf/templates/*`) inside `PdfDocument` (embedded font, base CSS), then printed by headless Chromium (`renderPdf`, one browser per process, CSS `@page` for size). Render in the worker, not in requests.
- Arabic blocks use `dir="rtl" lang="ar"`; values that may mix scripts are wrapped in `<bdi>`. Chromium must be installed where PDFs render (`playwright install chromium`).
- Every document starts with the shared `Letterhead` (`src/pdf/templates/letterhead.tsx`): logo, legal name, address, identifiers. Renderers load it with `loadCompanyLetterhead(tx, orgId)`, which embeds the logo as a data URI (Chromium renders offline). A logo change only affects documents issued afterwards.

### Exports
- `GET /api/exports/{kind}?filters&locale=fr|ar` → an .xlsx attachment (`buildExport`): the filters of the list it comes from (`exportParams`), the rows read with the member's rights and visibility (a commercial gets their own leads and sales), headers in the member's language, right to left in Arabic. Kinds: `collections` (journal des encaissements over a period — sales REC, charges RCH, rents and deposits QIT, valid and cancelled, with a summary by nature and method; each source needs its reading right), `sales`, `installments` (every installment of the live sales: paid, remaining, state), `units`, `leads`, `buyers`, `charges` (a residence's unit accounts and residents), `leases`, `invoices`, `ledger` (an account's ledger over a period, from its page), `report` (the management reports, one sheet per table).
- Cells are typed: amounts in dinars with two decimals (`excelAmount`: the one place a bigint becomes a number), calendar days as dates, instants at their Algiers time; 50 000 rows at most per sheet (narrow the filters). Every export is audited (`organization.export`: kind, filters, rows — Loi 18-07). Lists carry an « Exporter (Excel) » button with their current filters; `/exports` gathers them (the journal by period, a project's stock, a residence's accounts).

### Imports (reprise de données)
- `/imports` (sections by rights) → per kind an .xlsx template (`/api/imports/{kind}/template?locale=`: data sheets with headers in the member's language — French and Arabic headers are both recognized — an example row, a help sheet), then `POST /api/imports/{kind}` (multipart `file`, `project` / `residence`, `commit` 0/1, 10 MB) → `runImport`: every row is checked first (`prepare*` → `ImportPlan`: counts, blocking issues with sheet / Excel row / column / message key, warnings for rows left aside); with `commit` and nothing blocking, every write runs in **one transaction** (all or nothing) through the same services as by hand (`createUnit`, `updateUnitPrice`, `blockUnit`, `createBuyer`, `saveShares`, `addResident` take an optional outer `tx`), then `organization.import` is audited.
- Kinds: `units` (a project's units; buildings must exist; `unit:create`, prices need `price:update`, blocks `unit:block`), `buyers` (`buyer:create` + `buyer:read_all`), `leads` (`lead:create`; source, project, typologies, budget, financing by their labels; a manager assigns each to a commercial by e-mail, a commercial's leads are theirs; a phone already a live lead's = warning), `sales` (ongoing sales with their schedules and past payments; `sale:create` + `sale:sign` + `payment:create` + `buyer:read_all`: the gérant), `residents` (co-owners, occupants and tantièmes of a residence; `residence:update`). Already there (unit code, buyer NIN or phone + name, a current resident of the unit) = warning, left aside; the same row twice in the file = issue.
- Files: .xlsx (the template's sheets, or any single sheet), or **CSV** (UTF-8 with or without BOM, or UTF-16 as Facebook Lead Ads exports it; separated by `;`, `,` or tabs, quoted fields) read as one sheet with the template's headers.
- Cells: text or numbers; dates as Excel dates, `jj/mm/aaaa` or `aaaa-mm-jj`; amounts in dinars (`1 250 000,50` or a number); phones restored when Excel dropped the leading 0; choices by their French / Arabic label or common synonyms (« Local », « Virement », « Locataire »…).
- **Imported sales**: each sale of an `available` unit (buyers by NIN or phone, exactly one match), schedule lines dated or waiting for a milestone of the project (total = the sale price), payments ≤ price. Written as by hand without the side effects of a new sale: `RES-` (and `VSP-` when the VSP date is given) numbered at their own dates, unit `reserved` / `sold` (reason « Reprise de données »), no commission, no lead; payments `imported` with the previous system's receipt number (`legacy_receipt`), **no REC- receipt and no WhatsApp**; audited `reservation.import`; the reservation sheet is rendered. Imported payments count in statements, the journal export (old receipt number) and the portal (« ancien système »).

### Caching
- Tenant data is dynamic by default. Any `use cache` / cached function on tenant data must include `orgId` in its key and be tagged `org:{orgId}:{entity}`.

### Config
- `src/env.ts` validates: `DATABASE_URL` (app role), `DATABASE_OWNER_URL`, `BETTER_AUTH_SECRET` (≥32), `BETTER_AUTH_URL`, `S3_*`, `SMTP_*`, `SECRETS_KEY` (optional), `DEV_GATEWAYS`, `SATIM_TEST_URL`, `SATIM_PRODUCTION_URL`, `WHATSAPP_API_URL`. `.env.example` lists them with local defaults.
- **Organization secrets** (a SATIM password, API tokens) are stored encrypted (`encryptSecret`, AES-256-GCM) with `SECRETS_KEY` (base64 of 32 bytes; derived from `BETTER_AUTH_SECRET` when absent — set it in production: changing either key makes saved secrets unreadable, to be typed again). Never sent back to a browser nor written to the audit log.
- **Stand-ins** (`DEV_GATEWAYS`, default on outside production builds; e2e sets it): `/api/dev/satim/*` answers like SATIM's test platform and the test platform's URL points to it unless `SATIM_TEST_URL` is set; `/api/dev/whatsapp/*` accepts messages like the Cloud API (used unless `WHATSAPP_API_URL` is set). Never enable in production.

## 6. Domain glossary

| Business term (FR) | Code name | Notes |
|---|---|---|
| Promotion immobilière | `project` | |
| Bloc / Bâtiment | `building` | |
| Étage | `floor` | integer on unit; `0` = RDC |
| Lot (appartement, local, box, cave) | `unit` | `unit_type`: `apartment`, `commercial`, `office`, `parking`, `storage`, `villa` |
| Typologie F1…F6, duplex | `unit.typology` | |
| Surface habitable / utile | `unit.living_area`, `unit.usable_area` | m², `numeric(10,2)` (not money, decimals OK) |
| Grille de prix | `price_list` | versioned per project |
| Prospect | `lead` | one `full_name`, E.164 `phone`/`phone2`, `city` free text; `lead_source`: `facebook`, `instagram`, `whatsapp`, `ouedkniss`, `walk_in`, `referral`, `phone`, `website`, `other`; `lead_stage`; interest (project, typologies, budget, `financing_mode`) |
| Historique du prospect | `lead_activity` | append-only timeline (`lead_activity_type`) |
| Visite | `visit` | |
| Relance | `follow_up` | |
| Devis / Simulation | `quotation` | |
| Commission / Objectif | `commission` (+ `commission_rate`) / `sales_target` | targets per commercial and month: visits done, quotations issued, reservations signed (not withdrawn), VSP signed; commission = % of the net price earned at the VSP, rate per commercial or company default |
| Échéancier type | `payment_plan` / `payment_plan_step` | per project; step `trigger`: `signing`, `months_after_signing`, `milestone` |
| Réglages de la société | `organization_setting` | quotation validity, option hours, payment-call delay, withdrawal retention, late penalties (rate, grace, cap), default commission, VSP limits |
| Acquéreur | `buyer` | |
| Pièces du dossier (CNI, extrait de naissance, fiche familiale, attestation de travail, fiches de paie) | `buyer_document` | `document_kind` enum |
| NIN (numéro d'identification national) | `national_id_number` | |
| Option | `unit_option` | has `expires_at` |
| Contrat de réservation | `reservation` | |
| Vente sur plan (VSP, acte notarié) | on `reservation` (`sale_number`, `sale_signed_on`, `sale_notary`, deed scan) | status `sold`; `sale_contract` = its numbering doc type (`VSP-`) |
| Notaire | `notary` | |
| Échéancier / Échéance | `installment` (of a `reservation`) | built from the plan at reservation; milestone lines dated at validation |
| Appel de fonds | `payment_call` | |
| Encaissement / Reçu | `payment` / `receipt` | |
| Mode de paiement (espèces, chèque, virement, CCP, crédit, carte) | `payment_method` | `cash`, `cheque`, `bank_transfer`, `ccp`, `bank_loan`, `card` (online payments only; forms offer `counterPaymentMethods`) |
| Paiement en ligne (carte CIB / Edahabia, SATIM) | `online_payment` | `order_number` (10 digits) sent to SATIM; `created` → `pending` → `paid` / `failed` / `expired`; `paid` → `refunded` |
| Compte marchand SATIM (identifiant, mot de passe, n° de terminal) | `payment_gateway` | one per organization; `environment` `test` / `production` |
| Numéro WhatsApp Business / modèle de message | `whatsapp_account` / `whatsapp_kind` (`whatsappTemplates`) | one number per organization; ten notifications, each an approved template |
| Message WhatsApp | `whatsapp_message` | `queued` → `sent` → `delivered` → `read`, or `failed` |
| Consentement WhatsApp | `whatsapp_opt_in` (buyer, resident), `tenant_whatsapp_opt_in` (lease) | recorded by staff; « STOP » withdraws it |
| Pénalité de retard | `late_penalty` | |
| Désistement | `withdrawal` | refund / retention |
| Cession de réservation | `reservation_transfer` | |
| Changement de lot | `unit_swap` | |
| Livraison contractuelle / indemnité de retard de livraison | `reservation.delivery_due_on` / `deliveryPenalty` | the indemnity is shown, never booked |
| Attestation de garantie FGCMPI (Fonds de garantie et de caution mutuelle de la promotion immobilière) | `reservation.guarantee_number` (+ date, scan); `organization_setting.fgcmpi_number` (adhésion) | |
| Dossier administratif (titre foncier, permis de construire / de lotir, convention CTC, assurance RC, affiliation FGCMPI, certificat de conformité) | `project_document` (`project_document_kind`) | validity derived (expired, to renew within 60 days) |
| Garantie de parfait achèvement / décennale | `warrantyEnds` | 1 year / 10 years from the handover PV |
| Crédit bancaire (dossier, accord, déblocage) | `bank_loan` | one followed loan per sale; disbursements = payments with method `bank_loan` |
| Lettre de relance | `reminder_letter` | overdue lines kept as printed, bilingual PDF |
| Attestation (réservation, versements, paiement intégral, avancement des travaux) / Relevé de compte | `certificate` (`certificate_kind`: `reservation`, `payments`, `paid_in_full`, `progress`, `statement`) | numbered `ATT-`, content frozen at issue, bilingual PDF |
| Étape des travaux | `construction_milestone` | planned per project (stage); validated → installments due, payment calls |
| Compte rendu de chantier / avancement par bâtiment | `construction_report` / `building_progress` | dated, % per building, site photos; published ones shown to buyers |
| Remise des clés (rendez-vous, PV) | `handover` | one per sold unit: `scheduled` → `signed` (PV `PVL-`, unit `delivered`); PV de levée des réserves (`reserves_closed_on`) |
| Réserves à la livraison (corps d'état) | `punch_item` (`punch_trade`) | numbered per handover; `open` → `lifted` / `cancelled` |
| Réclamation SAV / résidence | `ticket` | |
| Bail (habitation / commercial) | `lease` | `lease_kind` `residential` / `commercial`; numbered `BAL-`; `active` → `ended`; a renewal is a new lease (`renewed_from_id`) |
| Loyer payé d'avance (mensuel, trimestriel, semestriel, annuel) | `rent_frequency` | rent periods derived (`buildRentPeriods`), due on their first day |
| Dépôt de garantie | `lease.deposit` (+ `deposit_carried` on a renewal) | collected as a payment, settled at the end (refunded / retained) |
| Quittance de loyer / reçu de dépôt | `rent_payment` (`kind` `rent` / `deposit`) | receipt `QIT-` on the same row |
| État des lieux (entrée / sortie) | `lease_inspection` | `inspection_kind` `check_in` / `check_out`; one of each per lease, final |
| Résidence (après livraison) | `residence` | |
| Syndic / Administration des biens | `property_management` | |
| Copropriétaire / Occupant | `resident` with `resident_kind`: `co_owner` / `occupant` | **`co_owner`, not `owner`** (clash with role, §12) |
| Quote-part / Tantièmes | `share` | integer, per unit per residence |
| Budget prévisionnel | `budget` | |
| Appel de charges | `charge_call` (+ `charge_call_line`) | one per unit and period; a `charge_period` is one issue of a budget period |
| Encaissement de charges / Reçu de charges | `charge_payment` | receipt `RCH-` on the same row |
| Clé de répartition | `distribution_key` | `equal`, `share`, `per_building`, `custom` |
| Bâche d'eau, électricité communs, ascenseur… | `charge_category` | |
| Fonds de réserve | `reserve_fund` | |
| Fournisseur / Prestataire, contrat, facture | `supplier` / `supplier_contract` / `supplier_invoice` | |
| Agent de sécurité, femme de ménage… | `staff_member` | `staff_role` enum |
| Pointage / Paie / Avance sur salaire | `attendance` / `payroll` / `salary_advance` | |
| Espace client (portail) / accès | `portal_link` | one live link per buyer file or resident record; `user_id` set at acceptance |
| Annonce / avis aux résidents | `announcement` | `announcement_category`: `general`, `works`, `outage`, `meeting`, `safety`; state `draft` → `published` → `archived` (`expired` derived) |
| Assemblée générale, résolution, feuille de présence, vote | `general_assembly` / `assembly_resolution` / `assembly_attendance` / `assembly_vote` | `assembly_kind`: `ordinary`, `extraordinary`; attendance `present`, `represented` (with `proxy_name`), `absent` |
| Procès-verbal (PV) / Convocation | `general_assembly.minutes_file_id` / `convocation_file_id` | bilingual PDFs |
| Majorité | `majority` | `simple` (votes cast), `absolute`, `two_thirds`, `unanimity` (of all tantièmes) |
| Budget de l'opération (bilan prévisionnel) | `project_budget_line` (`cost_category`: `land`, `studies`, `works`, `networks`, `fees`, `financial`, `marketing`, `other`) | saved as a whole |
| Marché (entreprise, bureau d'études), réception provisoire / définitive | `works_contract` | contractors are `supplier` rows |
| Situation de travaux, retenue de garantie | `works_invoice` (`gross`, `retention`, `net`) | numbered per contract; read-only once paid |
| Caisse / compte bancaire / compte CCP | `treasury_account` (`treasury_account_kind`: `cash`, `bank`, `ccp`) | one default per kind; closed, never deleted |
| Mouvement de trésorerie (dépense, recette, frais, virement, écart de caisse) | `treasury_movement` (`movement_kind`, `direction`) | cancelled with a reason, never edited |
| Arrêté de caisse | `cash_count` | counted vs ledger balance; the difference booked as an adjustment |
| Journal d'audit | `audit_log` | |
| Société (SARL) | `organization` | Better Auth table + legal fields below |
| RC, NIF, NIS, AI (identifiants légaux SARL) | `organization.rc_number`, `nif`, `nis`, `ai_number` | + `legal_name`, `address`, `wilaya`, `phone`; printed on documents |
| Membre / Invitation | `member` / `invitation` | Better Auth tables |
| Wilaya / Commune | `wilaya` / `commune` | free text on projects, leads and buyers; global reference tables deferred until a form needs a strict list |

## 7. Domain rules & invariants

### Money
- DZD stored as **`bigint` centimes** (`money()` column helper = `bigint({ mode: 'bigint' })`), JS **`bigint`** in code (type `Centimes`). Never `number`, float, `numeric`, `real`.
- `src/lib/money/`: `parseDZD()`, `formatDZD(amount, locale)` (fr `1 250 000,50 DA`, ar `1.250.000,50 د.ج`, Latin digits, U+00A0 separators), `amountInWordsFr()`, `amountInWordsAr()`, `allocate(total, weights)` (largest remainder — parts always sum to total), `applyRate(amount, basisPoints)` (half-up to the centime), `sumCentimes()`.
- Rates/percentages stored as integer **basis points** (1 % = 100 bp).
- Amount in words: French traditional spelling ("deux cents", "deux cent mille", "de" before round millions); Arabic MSA with counted-noun agreement (dual, 3–10 plural, 11–99 accusative, construct forms). Receipts print both: « Arrêté le présent reçu à la somme de : … » / « أوقف هذا الوصل على مبلغ: … ».
- Outside TS (JSON payloads, exports, API, audit JSON): decimal string of centimes.

### Dates
- Instants → `timestamptz` (`instant()` helper). Calendar dates (due dates, birth dates, contract dates) → `date`, typed `CalendarDate` ("YYYY-MM-DD"), meaning an Algiers day.
- "Today", display and document year are computed in `Africa/Algiers` (UTC+1, no DST) via `src/lib/dates` (`todayInAlgiers`, `yearInAlgiers`, `toCalendarDate`). Never from server-local time.
- Display `dd/MM/yyyy` (`formatDate`) and `dd/MM/yyyy HH:mm` (`formatDateTime`) in both locales.

### Document numbering (gapless)
| Document | `doc_type` | Prefix |
|---|---|---|
| Reçu | `receipt` | `REC` |
| Contrat de réservation | `reservation` | `RES` |
| Contrat VSP (internal ref) | `sale_contract` | `VSP` |
| Appel de fonds | `payment_call` | `ADF` |
| Appel de charges | `charge_call` | `ADC` |
| Reçu de charges | `charge_receipt` | `RCH` |
| PV de remise des clés | `handover` | `PVL` |
| Bail | `lease` | `BAL` |
| Quittance de loyer / reçu de dépôt | `rent_receipt` | `QIT` |
| Devis | `quotation` | `DEV` |
| Attestation / relevé de compte | `certificate` | `ATT` |
- Format `{PREFIX}-{YYYY}-{NNNNNN}`, e.g. `REC-2026-000123`; sequence per organization, per `doc_type`, per Algiers year of the issue date.
- `nextDocumentNumber(tx, scope, docType, issuedAt)` upserts the `document_sequence` row, then `UPDATE … SET last_value = last_value + 1 RETURNING` (row lock, same guarantee as `SELECT … FOR UPDATE`). It **must run in the transaction that inserts the document** — a rollback leaves no gap (tested, incl. 25 concurrent allocations).
- Numbers are never reused or edited; cancelled documents keep theirs.

### Unit status machine
| From | To | Trigger |
|---|---|---|
| `available` | `optioned` | option placed (`expires_at`) |
| `available` | `reserved` | reservation signed |
| `available` | `blocked` / `rented` | manual block (reason) / lease starts |
| `optioned` | `available` | option expired (job) or cancelled |
| `optioned` | `reserved` | reservation by the option holder only |
| `reserved` | `available` | withdrawal, or swap-out |
| `reserved` | `sold` | VSP signed at the notary |
| `sold` | `delivered` | handover PV signed |
| `available` / `blocked` | `delivered` | sold and handed over before the app (`recordPastDeliveries`, delivered project only) |
| `blocked` | `rented` | lease of a unit kept by the company |
| `blocked` / `rented` | `available` | unblock / lease ended |
- Anything else → `INVALID_TRANSITION`. `delivered` is terminal on the sales side.
- **Only** `transitionUnit(tx, actor, unitId, to, { reason, refType, refId })` (`src/server/inventory/transition-unit.ts`; `actor.userId` null for jobs) writes `unit.status`: row lock, validation, `unit_status_history`, audit `unit.status_change`. New units start `available` (history row, no transition).
- Manual block/unblock needs a reason (`blockUnit` / `unblockUnit`, permission `unit:block`). Units, buildings and projects are soft-deleted, and only when nothing is engaged (unit `available`/`blocked`; building/project without live units).
- Unit codes default to `{building}-{floor}-{nn}` (`A-03-02`; basements `S1`), unique per project; `generateUnits` skips existing codes (max 500 per run).
- Reservation transfer: unit stays `reserved`, buyer changes. Unit swap: A `reserved → available` + B `available → reserved` in one transaction.

### CRM (leads)
- Fixed pipeline `new → contacted → visit_scheduled → visited → negotiation → won | lost`; `lost` needs a `lost_reason`. Manual changes go anywhere; events only move a lead **forward** and never out of won/lost (`advanceStage`): follow-up done → contacted, visit planned → visit_scheduled, visit done → visited, quotation issued → negotiation. Every change writes `lead_activity` in the same transaction.
- Duplicates (same phone in `phone`/`phone2` of another live lead) are allowed and **flagged**, never stored as a flag. Managers merge: visits and follow-ups move to the kept lead, empty fields are filled, the other lead is soft-deleted with `merged_into_id` (its timeline stays visible), audited `lead.merge`.
- A commercial's new lead is assigned to them; managers assign or leave unassigned. Reassignment moves the previous owner's open follow-ups. Overdue follow-ups are derived (`due_at < now()` in SQL).

### Payment plans & quotations
- A plan's step shares (basis points) sum to exactly 10 000; `buildSchedule(price, steps, signingOn, milestones)` splits with `allocate()` and dates each line (signing day, signing + N months, milestone planned date). Construction milestones are planned per project with a construction `stage` (VSP limit check); module 3 validates them (payment calls), module 4 will add the construction follow-up.
- A quotation is issued for a lead and an `available`/`optioned`, priced unit, with a plan of the unit's project: number `DEV-YYYY-NNNNNN`, snapshots of list price, discount, net price and lines; `valid_until` = issue day + company validity. Only managers discount (≤ list price). Issued quotations are never edited or deleted, only cancelled with a reason (audited); "expired" is derived from `valid_until`.
- The bilingual PDF is rendered once by the `pdf.document` job (kind `quotation`, enqueued in the issuing transaction) and linked with `pdf_file_id`; the page offers a retry if it is missing.

### Pricing
- `unit.list_price` is the current asking price. It changes only through `updateUnitPrice` (one unit, reason required, audit `unit.price_change`) or by applying a **price list**.
- `price_list`: versioned per project (`V1`, `V2`…), `draft` → `applied` | `discarded`. A draft is prefilled from current prices, edited as a whole (bulk % change, price per m² × living area, rounded half-up), then applied in one transaction: only changed units get a `unit_price_history` row; one audit `price_list.apply` lists the changes. Applied/discarded lists are read-only.
- `unit_status_history` and `unit_price_history` are append-only (no `UPDATE`/`DELETE` grant).
- A reservation **snapshots** the agreed price and discount; later price-list changes never touch it.

### Reservations and VSP
- An option (`unit_option`, company duration) holds an `available` unit for one lead; its expiry job releases the unit. Only buyers of the holder's lead can reserve an optioned unit.
- `createReservation` (`sale:create`): 1–3 visible buyers (main first), an `available` (or optioned-for-them) priced unit, a plan of its project, a date not in the future; only `sale:discount` may discount (≤ list price). In one transaction: number `RES-`, snapshot of list price / discount / net price, installments from the plan (`allocate`, sum == price), option converted, unit `reserved`, lead activity + stage `won`, audit, reservation sheet job. The commercial credited is the lead's owner (else the main buyer's follower).
- Milestone installments have no due date until their milestone is validated: then `due_on = max(validation + company delay, reserved_on)` (`milestoneDueOn`); a milestone already reached at signing is due at signing.
- VSP (`sale:sign`): reserved sale only, date ≥ reservation; number `VSP-`, unit `sold`, lead activity, commission earned at the commercial's rate (else the company default; none at 0), audited.
- VSP limits: cumulative shares per construction stage are checked against the company limits — warnings only (form, sale page).
- Contract notary/reference editable (`sale:update`, audited); signed scans attached (reservation contract; the deed once sold).

### Payments, statement and reminders
- **Statement is derived** (`computeStatement`, `src/lib/statement.ts`): the total of valid payments is allocated FIFO over installments by due date (unknown dates last), then position → paid / remaining / state (`paid`, `overdue`, `due`, `upcoming`, `pending`) per line, plus due, overdue and advance totals. "Overdue" = due before today (Algiers) and not covered; never stored.
- Late penalty per overdue line (display only, never charged): `remaining × monthly rate × days late / 30` after the grace days, half-up, capped at `cap % × installment amount`.
- `recordPayment` (`payment:create`): refused above the remaining balance and on a closed sale; issues receipt `REC-` in the same transaction with a snapshot of what it settled (`receipt.allocation`), audited; receipt PDF job. Cheques: receipt « sous réserve d'encaissement », clearance recorded later (`clearCheque`).
- Payments and receipts are **immutable** (column grants): `cancelPayment` (`payment:cancel`, accountant) sets the payment and its receipt `cancelled` with a mandatory reason, audited; the installments become due again (derived).
- Validating a milestone (`milestone:validate`, final, audited) dates its installments in live sales and enqueues `payment_call.issue`: one numbered call `ADF-` per installment still unpaid, with amount, already settled and called amounts; idempotent per installment (unique `(reservation, installment_position)`).
- Overdue list (`/sales/overdue`), reminder letters (`sale:remind`: overdue lines and penalties snapshotted, pay-by date, bilingual PDF), daily 08:00 digest to cashiers and sales managers (nothing sent when nothing is overdue).

### Promoter's obligations (Loi 11-04)
- **Contractual delivery date** (`reservation.delivery_due_on`): the project's planned delivery at reservation (`createReservation`; an imported sale: its column, else the project's), corrected from the contract dialog (`updateReservationContract`, `sale:update`, audited before / after). Delay (`deliveryDelayDays`) = from that date to the handover PV, else to today. **Indemnity owed to the buyer** (`deliveryPenalty`): price × company monthly rate × days late / 30, half-up, capped at a share of the price (company settings `delivery_penalty_monthly_rate_bp` / `delivery_penalty_cap_bp`, 0 % = off by default) — shown on the sale page, never booked (the rate is the contracts'; nothing from the decree is hard-coded). The deliveries list flags each late sold unit; the dashboard counts the sold units past their date and not handed over (`handover:update`).
- **FGCMPI guarantee**: the promoter's membership number in company settings; per sale the guarantee certificate annexed to the VSP (number, date, premium, scan `reservation.guarantee`, readable on the portal like the sale's other files); a sold sale without one shows a warning, never blocking.
- **Regulatory file** (`project_document`, `project:update` to keep it, `inventory:read` to read it): per project, documents by kind (titre de propriété, permis de construire, permis de lotir, convention CTC, assurance RC professionnelle, affiliation FGCMPI, certificat de conformité, règlement de copropriété, état descriptif de division, assurance décennale, assurance CAT-NAT, autre with a title) with reference, issue and expiry days, issuer, notes and scan; « autre » needs a title, expiry never before issue; deleting soft-deletes (the scan stays). The project page shows the essential documents held or missing and each one's validity (`documentValidity`: expired, to renew within 60 days); the dashboard counts expired / expiring documents and the projects not delivered that miss an essential one (`project:update`). Audited `project_document.create / update / delete` on the project.
- **Warranties** (`warrantyEnds`): parfait achèvement one year and décennale ten years from the handover PV, shown on the sale page and the portal.

### Treasury (cash desks and accounts)
- **Accounts** (`treasury_account`; `treasury:read`: gérant, comptable, caissier; `treasury:update`: gérant, comptable; `treasury:count`: the three): cash desks (caisses), bank and CCP accounts with an opening balance on their opening day (flows dated before it are in it); one default account per kind among open ones; name, bank, RIB / RIP and notes editable, the opening fixed; closing needs a nil balance (transfer the rest first), then the account takes no money. Audited `treasury_account.create / update / close`.
- **Where collections land** (`resolvePaymentAccount`, called by `insertSalePayment`, `insertChargePayment` and the rent payments): the account chosen in the form (« Encaissé sur », open, of a kind the method fits: cash → a cash desk; cheque, transfer, CCP, bank loan, card → a bank or CCP account), else the default account of the method's kind (a CCP payment falls back on the default bank); none when the organization keeps no accounts. Online payments land on the default bank account. A cancelled payment leaves its account's balance.
- **Movements** (`treasury_movement`, `treasury:update`): an income, an expense (label, category, reference) or a bank fee on one account, or a transfer between two (two rows sharing `transfer_id`, e.g. the cash desk's takings paid into the bank); never in the future nor before the account's opening; immutable, cancelled with a reason (both sides of a transfer). Audited.
- **Balance and ledger** (`accountTotals`, `getAccountLedger`): opening balance + valid collections (sales, charges, rents and deposits) + live movements, by day; today's money in and out; cheques received and not cleared (« dont chèques à encaisser »). `/treasury` lists the accounts with totals per kind; `/treasury/[accountId]` shows the ledger over a period (the current month by default): the balance carried forward, each line with its source, payment method and receipt, the running balance; Excel export (`ledger`).
- **Arrêté de caisse** (`cash_count`, `treasury:count`, cash desks only): the cash counted on a day against the ledger's balance that day; a difference needs an explanation and is booked as an `adjustment` movement (never cancelled: count again), so the ledger follows the cash actually there. Final; audited `cash_count.create`.
- **Outflows**: contractors' progress invoices and released retentions (§ Construction costs) and supplier invoices are paid from an account (« Payé depuis », chosen or the method's default) and appear in its ledger. Staff pay, withdrawal refunds and deposit refunds are not yet tied to an account: record them as expense movements (see §13).

### Construction costs (contractors)
- **Rights**: `cost:read` (gérant, comptable, responsable technique), `cost:update` (gérant, responsable technique: budget, contracts, progress invoices, acceptances), `cost:pay` (gérant, comptable: payments and retentions). The directeur commercial and the commercials do not see costs or margins.
- **Budget** (`project_budget_line`): per project, lines by category (land, studies, works, VRD networks, fees, financial, marketing, other) saved as a whole; audited `project_budget.save`.
- **Contracts** (`works_contract`): with a contractor or design office (a `supplier`; `createContractor` adds one from the costs page), a category, reference, object, amount (TTC), retention of guarantee (default 5 %, 0–10 %), signing day (not in the future) and planned end; corrected while open — never below what is invoiced, the retention rate fixed once a progress invoice exists; deleted (soft) only without progress invoices. **Réception provisoire** then **définitive** (dated from the signing / the provisional on, with notes); **résiliation** with a reason (no more invoices). Audited.
- **Progress invoices** (`works_invoice`, situations): numbered per contract, invoice day not before the signing, gross amount; the retention (`invoiceSplit`: half-up at the contract's rate) and net payable are computed; the contract's total never above its amount; corrected while unpaid; only the last unpaid one is deleted. **Paid** (`cost:pay`, from the invoice day to today) from an account (§ Treasury), then read-only. After the réception définitive the retention held is **released** once, from an account. Audited `works_invoice.*`, `works_contract.release_retention`.
- **Project costs page** (`/projects/[id]/costs`): per category budget, committed (contract amounts; a terminated contract commits what it invoiced), invoiced, paid; unpaid net and retentions held; **margin** (`projectMargin`): expected revenue (live sales signed + available / optioned stock at list price) against the forecast cost (per category the larger of the budget and the committed); **12-month cash-flow forecast**: expected collections (each live sale's remaining installments by due month, overdue ones in the current month; installments waiting for a milestone shown apart) against expected spending (unpaid progress invoices by due day, what remains to invoice on open contracts spread evenly to their planned end, `spreadRemaining`), net and cumulative.

### Reports
- `/reports` (`report:read`: gérant, directeur commercial, comptable), over a period (this year by default) and optionally one project, all sales of the organization: totals (reservations signed and not withdrawn, VSP signed, collected; withdrawn ones counted apart); **by month** (reservations and VSP signed, collected); **by project and typology** (sales, amount, average price per m² of living, else usable, area); **commercials** (leads given in the period, reservations credited, VSP, conversion, amount, collected on their sales); as of today, **receivables by age** (`ageingBucket`: not due, 1–30 … over 180 days late, waiting for a milestone) and **expected collections** for the next 6 months (overdue counted in the current month); **stock** by project and typology (available, optioned, reserved, sold, value at list price). Excel export (`report`).

### Certificates (attestations)
- Issued on a live sale (`sale:certify`: gérant, directeur commercial, comptable, caissier; the sale must be visible) from the sale page, optionally addressed to a bank or an administration (« À l'attention de … », else « à qui de droit »): **attestation de réservation** (buyers with birth and NIN, the unit, the contract, the price in words; the VSP once signed), **attestation de versements** (needs a valid payment: total paid in words, every valid payment with its receipt — an imported one with the previous system's number — cheques not cleared marked « sous réserve d'encaissement », what remains), **attestation de paiement intégral** (nothing left to pay and no cheque awaiting clearance), **attestation d'avancement des travaux** (the building's progress from its latest live report, the milestones planned and reached), **relevé de compte** (schedule with paid / remaining / state, payments, totals; not an attestation, no signature).
- `issueCertificate`: number `ATT-` in the transaction, everything printed frozen in `certificate.data` (`certificateSnapshot`: amounts as centime strings — later payments never change an issued certificate), bilingual PDF by the worker (`pdf.document` kind `certificate`: letterhead, « Nous soussignés … attestons que », « pour servir et valoir ce que de droit », place and date, signature and stamp box), filed under the sale; audited `certificate.issue` on the sale. Immutable (grants: only the PDF link).
- **Portal**: the buyer sees every certificate of its sale and draws its own relevé de compte (`issuePortalStatement`, progress from published reports only, marked « établi depuis l'espace client »); the one drawn earlier the same day is served again while the paid total is unchanged. Attestations stay issued by staff (signed and stamped).

### After the reservation
- **Withdrawal** (`withdrawal`): reserved sales only; proposed (`sale:withdraw`) with a retention in basis points of the amount paid (company default prefilled) and a reason; one open proposal per sale. The gérant (`sale:approve`) rejects (note required) or approves: amounts recomputed on what is paid at approval, sale `withdrawn` (`ended_on`), unit `available`, earned commission cancelled, lead activity, audit. Payments stay valid; the refund (paid − retention) is recorded when paid out (`payment:create`).
- **Transfer** (`reservation_transfer`): reserved sales only; buyers replaced (payments stay with the sale), history row, sheet rendered again, audited.
- **Unit swap** (`unit_swap`): reserved sales only, within the project; target `available` (or optioned for the sale's lead); new price = list − discount (managers), must be ≥ paid; old unit `available`, new unit `reserved`; installments keep shares and dates, amounts split again with `allocate`; history row, sheet rendered again, audited.
- **Bank loan** (`bank_loan`): one followed loan per sale (`preparing → submitted → approved | refused | cancelled`; approved needs the amount); disbursements are payments with method `bank_loan`.
- **Commissions**: earned at the VSP; accountants mark them paid (`commission:update`); the gérant sets per-commercial rates (`organization:update`); each commission keeps its rate.

### Construction follow-up and deliveries (module 4)
- **Progress reports** (`construction_report`; `construction:update`: gérant, responsable technique; `construction:read`: every staff role): per project, dated (never in the future), a title and a text in French, Arabic optional, published to the project's buyers (portal) or internal, with the progress of the buildings reported on (0–100 %, `building_progress`; a blank building is not reported this time) and site photos (JPEG/PNG/WebP, 10 MB, up to 20). Rewritten as a whole; deleting soft-deletes the report and discards its photos. A building's current progress is the one of its latest live report (date, then entry); `/construction` lists every project with its buildings' progress, its last report and its next milestone.
- Milestones keep their role (§ Payment plans): planned on the payment plans page, validated (`milestone:validate`) there or on the project's construction page.
- Buyers (portal) see on their sale's page their building's progress from published reports only, the milestones and the latest 10 published reports of the project with their photos.
- **Deliveries** (`handover`; `handover:read`: gérant, directeur commercial, responsable technique, gestionnaire — every delivery of the organization; `handover:update`: the first three). One handover per sold unit (VSP signed). `/deliveries` lists the sold units with a derived state (`deliveryState`, `src/lib/handovers.ts`): `not_ready` (no handover and the project neither delivered nor with its handover-stage milestone validated), `to_schedule`, `scheduled`, `reserves` (signed, reserves open or lifted without their closing PV), `delivered`; active ones by default, appointments first, with what remains to pay. Nothing is blocked by the readiness: it only sorts the work.
- **Appointment**: scheduling creates the handover (date-time in Algiers time, internal note); it moves until the PV is signed. No e-mail to the buyer (the portal shows it; WhatsApp is Phase 3).
- **Reserves** (`punch_item`): location, description, corps d'état, optional due day; numbered within the handover (a deleted one moves the next ones up). Recorded before or after the PV until the reserves are closed. Open ones can be lifted (date ≤ today, note) — before the PV a reserve fixed is then not printed — or cancelled with a reason; an open reserve not printed on the signed PV is edited or deleted, a printed one only lifted or cancelled.
- **PV de remise des clés** (`signHandover`, final): sold sale only, dated between the VSP and today; numbered `PVL-` in the transaction; keeps who received the keys, the number of keys, the meter readings, observations, the reserves still open (snapshot `reserves`, printed) and what remains to pay on the sale (`outstanding`: allowed with a warning, printed when not zero); the unit becomes `delivered` (`transitionUnit`, ref `handover`); if the unit belongs to a residence without a current co-owner, the sale's buyers become its co-owners from the PV date (main buyer first); audited `handover.sign`; bilingual PDF (`handover_pv`).
- **PV de levée des réserves** (`closeReserves`): once no reserve is open and at least one was lifted, dated from the PV and the last lifting on; closes the reserves (no more changes); audited `handover.close_reserves`; bilingual PDF (`handover_release`) listing every reserve with its lifting date or cancellation. Later defects go through tickets (residence).
- **Delivered before the app** (`recordPastDeliveries`, `handover:update`): in a `delivered` project, units still `available` or `blocked` (never sold through the app) are marked `delivered` with a reason (status history); the form ticks the units that have a current co-owner. Units still owned by the promoter stay as they are.

### Rentals (module 5)
- **Leases** (`lease`; `lease:read`: gérant, directeur commercial, comptable, caissier, gestionnaire; `lease:update`: gérant, directeur commercial, gestionnaire) rent the units the promoter keeps: an `available` unit or one kept by the company (`blocked`) becomes `rented` (`transitionUnit`, ref `lease`); one active lease per unit. A lease (numbered `BAL-`, signed on a day not in the future) has a kind (habitation / commercial), a tenant (person or company: name, Arabic name, NIN or RC, phone, e-mail, address, activity), a start, a duration in months (1–120; the term's last day is derived), a monthly rent, an optional monthly charges provision, a payment frequency and a deposit. When the unit belongs to a residence, the tenant becomes its main occupant from the start (`occupant_id`).
- **Rent schedule** (derived, `buildRentPeriods`, `src/lib/rentals.ts`): from the start, one period per frequency (the last one shorter), each due on its first day (paid in advance) for its months of rent and charges; FIFO statement like sales (`rentStatement`: paid, remaining, overdue; no penalties). State (`leaseState`): upcoming, running, ending (last day within 60 days), expired (term over, not ended), ended.
- **Payments** (`rent_payment`, `payment:create`): rent (never above what remains on the schedule; allocation snapshot printed) or the deposit (never above what is missing of it, active leases only); methods cash, cheque, transfer, CCP; receipt `QIT-` in the same transaction (bilingual quittance / deposit receipt via the shared receipt template, filed under the lease); cheques « sous réserve », cleared later; cancelled by accountants with a reason (a settled deposit's payments no longer); audited on the lease.
- **Corrections** (`updateLease`): the tenant's details at any time (the occupant follows); the terms only while no payment exists; a renewal keeps its start.
- **End** (`endLease`, from the signature to today, reason): the unit is `available` again, the occupancy ends (removed if it had not started), periods starting after the last day are no longer due. **Renewal** (`renewLease`): a new lease `BAL-` for the same tenant and unit from the day after the term with its own terms; the current one ends on its last day (its end reason is the renewal's number), the deposit held is carried over (`deposit_carried`), the unit stays rented. **Deposit settlement** (`settleDeposit`, ended leases not renewed): refunded + retained = held, a reason when something is retained; final.
- **États des lieux** (`lease_inspection`, `lease:update`): d'entrée (active lease) and de sortie (before or after the end), one of each, dated from the signature to today: each element of the unit with its condition (bon / moyen / mauvais) and remarks (rows prefilled with the usual elements, at check-out with those of the entry), keys, meters, observations; final; bilingual report (`lease_inspection`) whose exit version shows each element's condition at the entry; audited.
- **Overdue rents** (reminders only, no penalties): `/rentals/overdue` lists the leases (active or ended) with rent due before today and not paid, most late first; the dashboard shows them (`lease:read`) and the leases to end or renew (term within 60 days or over, `lease:update`); the daily digest e-mails the overdue rents and the leases ending within 30 days to property managers and cashiers. A rented unit's sheet links its lease; a free or kept one offers « Louer ».

### Online payment (Phase 3)
- **The promoter's own SATIM account** (`payment_gateway`, `organization:update`): each organization is paid on its own SATIM merchant account (CIB and Edahabia cards): login, password (encrypted, never sent back), terminal (`force_terminal_id`), test or production platform, and what the portal may pay (sales installments, charges). Audited `organization.online_payment` (never the password).
- **Paying** (portal, `startOnlinePayment`): a buyer pays its own live sale, a co-owner the charges of its unit (`targetId`); at least 50 DA, at most the remaining balance (installments: price − paid; charges: called − paid); the amount offered is what is due today, else the next installment or call (`onlinePaymentOffer`); the conditions (`/portal/payment-terms`) are accepted first. The `online_payment` row (random 10-digit `order_number`, unique per organization, drawn again when SATIM already knows it) is registered with SATIM (`register.do`: amount in centimes, currency 012, FR / AR page, return and fail URL `/api/online-payments/return?org=…&id=…`) and the browser goes to SATIM's page; `online_payment.check` is scheduled 30 minutes later.
- **Confirmation** (`finalizeOnlinePayment`, on the return, the check job, a refresh): only SATIM's answer counts (`confirmOrder.do`), never the return URL's parameters. Paid (`OrderStatus` 2) → recorded in the same transaction by the counter services (`insertSalePayment` / `insertChargePayment`, in a savepoint): method `card`, by the paying portal account, dated the day the payment started, reference = the order number, receipt REC- / RCH- (signed « Paiement en ligne · SATIM » instead of a cashier); declined, cancelled or unknown → `failed` with SATIM's message; still open → `pending`, `expired` when SATIM still has it unpaid after its 20-minute session (check job). A paid answer also settles a failed or expired payment: money taken is always recorded. Row lock: idempotent.
- **Not recordable** (sale closed or balance settled meanwhile, amount different from SATIM's): `paid` with an `issue` (message key), shown « À traiter » on `/online-payments` and on the accountants' dashboard; the accountant refunds it (`refundOnlinePayment`, `payment:cancel`: SATIM `refund.do` first — skipped if SATIM already refunded it — then the payment and its receipt cancelled with the reason; `refunded`). A recorded payment is refunded the same way. Audited `online_payment.paid` (job, no actor) and `online_payment.refund`.
- **Result page** (`/portal/payments/[id]`, what SATIM asks of merchants): outcome, SATIM's message, order and transaction numbers, authorization code, amount, date and time, masked card, the receipt, print, SATIM's free number 3020; `/portal/payments` lists the account's payments. Test platform payments carry « Test » (recorded with a receipt like real ones: the accountant cancels them).
- **Staff list** (`/online-payments`, `payment:read`; sales payments need `sale:read_all`, charges ones `charge:read`): status, order, authorization, SATIM's message, receipt; filters (status, « à traiter », order number or payer); re-check (`payment:create`), refund (`payment:cancel`).
- **Stand-in**: `/api/dev/satim/*` (DEV_GATEWAYS) speaks SATIM's REST protocol and shows a page with « Payer », « Refuser la carte », « Annuler »; its orders live in the server's memory (a restart forgets them: unknown = declined).

### WhatsApp notifications (Phase 3)
- **The promoter's own number** (`whatsapp_account`, `organization:update`): WhatsApp Business Cloud API — phone number id, optional WABA id, permanent access token and app secret (encrypted, never sent back), the language of the templates (French or Arabic: one per organization), and each notification switched on once its template is approved by Meta (default name, or the organization's). The settings page shows the template texts to submit (category Utility; `whatsappTemplates`, never starting or ending with a placeholder), the webhook URL (`/api/webhooks/whatsapp/{orgId}`) and its verify token (drawn once). Audited `organization.whatsapp` (never the secrets).
- **Consent**: only people who agreed get messages — `whatsapp_opt_in` on the buyer file and the co-owner / occupant record, `tenant_whatsapp_opt_in` on the lease (checkboxes in their forms; the gestionnaire toggles a resident's); co-owners from a sale take their buyer file's consent, a tenant's occupant record the lease's. Only mobiles (Algerian +213 5/6/7, or foreign numbers): landlines are skipped. A « STOP » reply (also « arrêt », « توقف ») withdraws the consent of every record with that number.
- **Notifications** (`notify.ts`, queued in the transaction of the event, each recipient's number once): payment received (sales receipt, counter or online), appel de fonds, sales reminder letter, handover appointment set or moved — to the sale's buyers; charge call (its addressee), charge payment, charge reminder — to the unit's main co-owner; rent or deposit received — to the tenant; announcement published — to the residence's co-owners and occupants; general assembly convened — to its co-owners. Parameters: names, amounts (`formatDZD`), dates, the unit and project or residence, numbers; flattened (no line breaks) and capped. With WhatsApp off (the default) an event costs one query; a message whose parameters do not fit its template is logged as failed, never sent; nothing ever blocks the event itself.
- **Sending** (`whatsapp.send`): template message through the Cloud API → `sent` with Meta's id; refused → `failed` with Meta's code and message; Meta unreachable or throttling → retried, `failed` after the last try. **Webhook**: Meta's verification (`hub.verify_token`), then calls signed with the app secret (`X-Hub-Signature-256`; without an app secret they are refused): delivery statuses move a message forward only (sent → delivered → read, or failed), replies are read for « STOP ».
- **Log** (`/whatsapp`, `notification:read`): every message, latest first, with its kind, recipient, template and language, Meta's status or error and its record (sale, residence, lease); filters by status and kind. Messages are never deleted.

### Residence charges
- `share` = integer weight per unit per residence (tantièmes, e.g. on a 10 000 basis). A residence enrols its project's live units with their inventory quote-part (`unit.share`, else 0); tantièmes are saved as a whole or split by area (living area, else usable area) with `allocate()`; audited `residence.shares`.
- Distribution keys: `equal`, `share`, `per_building`, `custom` (explicit unit list, weighted `equal` or `share`, e.g. RDC excluded from elevator). Every distribution uses `allocate()` → lines sum exactly to the charge.
- **Budget** (`budget` + `budget_line`): one per residence and calendar year, an annual amount per category; draft (saved as a whole) → approved (`charge:create`, audited `budget.approve`): read-only, freezes the call frequency and the reserve fund rate. A category in an approved budget cannot be deleted.
- **Calls** (`src/lib/charges.ts` `buildChargeCalls`): each category's annual amount is called in equal parts (`periodPart`), each part split over the category's units by its key; the reserve fund (rate × annual budget) is split over every unit by tantièmes. `issueChargePeriod` (`charge:create`): one `charge_period` per budget period (unique while issued), one numbered call `ADC-` per unit with something to pay, addressed to its main co-owner on the issue day (none = a unit the company still owns), lines snapshotted, PDF job, audited `charge_period.issue`. Refused when a part cannot be split (no unit, no tantièmes). `cancelChargePeriod` (`charge:cancel`, reason): its calls stop counting; the period can be issued again. Periods, calls and lines are immutable (grants).
- **Payments** (`charge_payment`, `payment:create`): receipt `RCH-` on the same row with a snapshot of the calls it settled; methods cash, cheque, transfer, CCP (no bank loan); cheques « sous réserve », cleared later; cancelled by accountants with a reason (`payment:cancel`), never deleted; audited.
- **Unit account** (`chargeStatement`, derived): valid payments applied FIFO to the live calls (due date, then number), no penalties; what exceeds every call issued so far is an advance for the next ones; reserve collected = each call's reserve part × paid / amount.
- **Suppliers** (`supplier`, per organization; `supplier:update`: gérant, comptable, gestionnaire): contracts per residence (period, optional category, indicative annual amount); invoices (`supplier_invoice`) booked to a charge category of the residence (a contract's category by default) or paid from the reserve fund (works); number unique per supplier; editable and deletable while unpaid, then read-only once paid (date, method, reference); audited. A contract's and an invoice's scan can be attached or replaced at any time (`setContractScan`, `setInvoiceScan`).
- **Staff** (`staff_member`, `staff:update`: gérant, comptable, gestionnaire): agents of a residence (role, net monthly salary, charge category their pay is booked to, hire/departure dates); salary advances deducted from a month's pay; monthly attendance grid (marked days: absence, leave, sick, day off; unmarked = worked; Friday/Saturday shaded); monthly pay entered as net amounts (no IRG/CNAS): base + bonus − deduction − the month's advances = net (never negative), editable/deletable until paid; a month's advances are locked once its pay is recorded; audited.
- **Tickets** (`ticket`, `ticket:create`/`ticket:update`: gérant, gestionnaire): on a unit or the common areas of a residence, category and priority; workflow `open → in_progress → resolved → closed` (`in_progress ↔ open`, `resolved → in_progress` reopens, `cancelled` from open/in progress; closed and cancelled are final, `ticketTransitions` in `src/lib/tickets.ts`); assigned to an employed agent of the residence or a supplier (not both); every change goes to the append-only `ticket_event` history (grants). Residents will open them from the portal (module 7).
- **Budget vs actual** (`getBudgetReport`, `charge:read`): per category and calendar year, budget, called (lines of the year's live calls), spent (invoices dated that year, paid or not, plus the staff pay of the year: base + bonus − deduction) and paid; reserve fund (all years): called, collected (derived), spent on works (reserve invoices), balance.
- **General assemblies** (`assembly:read` / `assembly:update`: gérant, gestionnaire): `draft → convened → closed`. A draft (date, time, place, kind) gets its agenda of resolutions, each with its majority; it can be edited or deleted. Convening (needs one resolution) fixes the agenda and renders the bilingual convocation (`assembly_convocation`), audited `assembly.convene`. Then the attendance sheet is saved as a whole: every unit of the residence is present, represented (proxy name required) or absent (left out = absent; the promoter votes for units without a co-owner); votes are saved as a whole, one choice (for / against / abstain) per present or represented unit and resolution (no choice = did not vote); a unit made absent loses its votes. Results by tantièmes (`isAdopted`, `src/lib/assemblies.ts`): `simple` = more for than against among votes cast; `absolute` (> ½), `two_thirds` (≥ ⅔) and `unanimity` count over all the residence's tantièmes, absent units included. No quorum is enforced (the share present or represented is shown and printed). Closing (from the meeting day, with the attendance recorded; chair, optional secretary and end time) freezes the sheet (tantièmes, co-owner names), the total, each resolution's tallies and result, renders the bilingual minutes (`assembly_minutes`: bureau, attendance summary, each vote with opponents and abstainers, attendance sheet annex) and is final; audited `assembly.close`.
- **Announcements** (`announcement:read` / `announcement:update`: gérant, gestionnaire): per residence, bilingual (French required, Arabic optional), a category, an optional last day shown (`expires_on`) and a pin. A draft is edited or deleted; publishing (expiry not past) makes it read-only, shown to residents (portal, module 7) and renders the bilingual notice to post in the building (`pdf.document` kind `announcement`, filed under the residence); withdrawing (`archived`) hides it and keeps it in the history; past its last day it is `expired` (derived). Nothing is e-mailed or texted.
- **Overdue charges** (reminders only, never penalties): `/residences/overdue` lists every unit with calls due before today and not covered, most late first; reminder letters (`charge:remind`: gérant, comptable, caissier, gestionnaire) keep the overdue calls as printed, a pay-by date (default 8 days) and the addressee, bilingual PDF; the daily digest e-mails property managers and cashiers when something is overdue.

### Audit & deletion
- Audited: prices, payments, receipts, charge categories, budgets, charge periods, charge payments, supplier invoices, general assemblies (convening, closing with results), handovers (PV signed, reserves closed), leases (signed, corrected, ended, renewed, deposit settled, états des lieux) and rent payments, online payments (confirmed, refunded), certificates issued, imports, the regulatory files, treasury accounts, movements and cash counts, project budgets, contracts, progress invoices and their payments, the SATIM account and the WhatsApp number, contracts (reservation, sale, contract details), installments/schedules, unit status, milestone validation, withdrawals (propose / approve / reject / refund), transfers, unit swaps, commissions (paid, rates), organization creation, invitations, member joins/role changes/removals.
- `audit_log(organization_id, actor_user_id, action, entity_type, entity_id, before jsonb, after jsonb, reason, created_at)` written by `recordAudit(tx, scope, entry)` in the same transaction as the change (bigint → string, Date → ISO). `action` is semantic: `<entity>.<verb>`, e.g. `receipt.cancel`, `member.update_roles`. `actor_user_id` null for jobs.
- DB grants enforce it (`post-migrate.sql`): no `UPDATE`/`DELETE`/`TRUNCATE` on `audit_log`, `reservation_transfer`, `unit_swap`; payments and receipts: no `DELETE`, column-level `UPDATE` (cancellation, cheque clearance, PDF link) only; payment calls, reminder letters and certificates: only their PDF link; reservations and withdrawals: no `DELETE`; charge periods: only their cancellation; charge calls: only their PDF link; charge call lines: append-only; charge payments: cancellation, cheque clearance and PDF link only; charge reminders: only their PDF link; ticket events: append-only; handovers and leases: no `DELETE`; rent payments: cancellation, cheque clearance and PDF link only; états des lieux: only their PDF link; online payments and WhatsApp messages: no `DELETE`; treasury accounts: no `DELETE`; treasury movements: only their cancellation; cash counts: final.
- Business records are soft-deleted (`softDelete()` helper: `deleted_at`, `deleted_by`); queries exclude them by default.

## 8. Coding conventions

| Thing | Convention | Example |
|---|---|---|
| Tables | snake_case, singular | `payment_call` |
| Columns | snake_case via Drizzle `casing`; FK `<entity>_id`; helpers `id()`, `organizationId()`, `timestamps()`, `softDelete()`, `money()`, `instant()` | `unit_id` |
| Drizzle | camelCase TS props; import `@/db/*` only in the data layer | `unitId` |
| Enums | Postgres enums, snake_case values, defined once as `const` arrays reused by Drizzle and Zod | `documentTypes` |
| Files | kebab-case | `payment-schedule.ts` |
| Server functions | verb-first | `createReservation`, `listUnits` |
| Server Actions | `<verb><Entity>Action` | `cancelReceiptAction` |
| Permissions | `resource:action` | `receipt:cancel` |
| i18n keys | English camelCase, namespaced by module | `members.invite.submit` |
| Commits | Conventional Commits, small, each green on `pnpm check` | `feat(inventory): add unit status machine` |

- **Validation**: one Zod schema per input in `schemas.ts`, used by the form (`zodResolver`) and the action. **Zod messages are i18n keys** (`"validation.required"`), translated by `TextField` / `useTranslateKey`. Parse at every boundary: actions, route handlers, job payloads, env, seed input. Form inputs are strings; builders in `src/lib/zod.ts` (`moneyText` → bigint, `intText`, `optionalAreaText`, `optionalDateText`, `codeText`…) transform them.
- **Forms**: `useForm<z.input<S>, unknown, z.output<S>>({ resolver: zodResolver(S) })` and submit the **raw** values: `form.handleSubmit(() => onSubmit(form.getValues()))` — the action re-parses (transformed values such as bigint do not cross the wire). Field components: `TextField`, `SelectField`, `TextareaField`, `CheckboxField`, `CheckboxGroupField`; server field errors via `applyFieldErrors`. Confirmations via `ConfirmAction`.
- **Result & errors**: `Result<T> = { ok: true; data } | { ok: false; error: AppErrorShape }`; `AppError(code, messageKey?, { fieldErrors, details })` with codes `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INVALID_TRANSITION`, `UNEXPECTED`. Services throw, `defineAction` converts, `useAction` toasts `t(messageKey)`. Unexpected errors are logged server-side, returned as `UNEXPECTED`.
- **i18n**: no hard-coded UI strings (incl. aria labels); every key in `fr.json` **and** `ar.json` in the same change (tested, incl. ICU arguments). Arabic = Modern Standard Arabic. Latin digits in both locales. `<html lang dir>` set per locale. Use `Link`/`redirect`/`useRouter` from `@/i18n/navigation` with locale-less paths. Page params: `toLocale(params.locale)`.
- **RTL/UI**: Tailwind logical utilities only (`ms-/me-/ps-/pe-/start-/end-/text-start/rounded-s/border-e`), enforced by `pnpm lint`; directional icons get `rtl:rotate-180`; physical `side` props (sidebar, toaster) are set from the locale direction. Emails, passwords, codes and numbers in inputs/cells get `dir="ltr"`. shadcn/ui for primitives; forms with react-hook-form + `TextField`; data grids with `DataTable` (below).
- **Source text**: never paste invisible or bidi-control characters (U+00A0, U+202F, U+200E…) in code — write `\u00a0`-style escapes (`pnpm lint` rejects them; tools may decode `\u` escapes when writing files, so check with grep).
- **TypeScript**: no `any`, no `!` outside tests, `import type` for types, exhaustive `switch` on enums.
- **Phones**: stored E.164 (`+213…`) via `normalizePhone` / zod `phoneText()`; shown with `PhoneText` (national for Algeria, international otherwise, always LTR); searched with `phoneSearchDigits`.
- **Date-times typed by users** (`datetime-local`) are Algiers time: zod `dateTimeText()` → instant; `toAlgiersDateTimeInput()` for defaults.
- **Lists**: server-paginated `DataTable` (TanStack Table v9 column helpers) + `Pagination` links; filters live in the URL (`useSearchParamsState`, page reset on change). Wrap the app shell content with `min-w-0` so wide tables scroll inside their frame.
- **React compiler rules**: no `Date.now()`/`Math.random()` during render (derive "overdue" etc. in SQL or pass data); `useWatch({ control, name })` instead of `form.watch()`; no JSX elements directly in array literals (use `{ label, value }` objects).

## 9. Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest (no DB) | money (parse, format, allocate — incl. random property test, rates), amount in words FR/AR (table-driven), dates, permissions, safeNext, message catalogs parity |
| Integration | Vitest + real Postgres `realestate_test` | every service function: happy path, forbidden per role, invariants, audit rows; Better Auth flows through `auth.api` (`tests/auth-helpers.ts`) |
| Security | Vitest + Postgres | RLS catalog (forced RLS + policy on every tenant table); cross-tenant read/update/insert refused; app role cannot bypass RLS; audit_log append-only |
| Concurrency | Vitest + Postgres | parallel `nextDocumentNumber` → exactly 1…N; rollback leaves no gap |
| Jobs/email | Vitest + Mailpit | handler delivers via SMTP (checked through Mailpit API); enqueue stores the job |
| PDF | Vitest + Chromium | template HTML (RTL blocks, `<bdi>`, amounts in words) and one-page PDF |
| Imports | Vitest | templates (sheets per language, help), leads from a CSV export (BOM, `;`, quoted separators, known phone left aside, a manager's assignment, a commercial's own), units (issues, warnings, all or nothing, prices and blocks, rights), buyers then sales (a refused file writes nothing, RES/VSP numbers, statement, imported payments without receipts, audit), co-owners and shares |
| Obligations | Vitest | validity, delay, indemnity (rate, half-up, cap, off), warranties; regulatory file (rights, validation, scan, audit, dashboard alerts); delivery date snapshot and contract correction (audit), guarantee scan, late deliveries in the list and the dashboard |
| Treasury | Vitest | collections on their accounts (chosen, default per method, CCP fallback, wrong kind refused, none without accounts), balances and cheques pending, cancelled payments, movements and transfers in the ledger (running balance), cancellation of both sides, cash counts with an explained difference, closing only when empty, closed accounts refused, rights, audit, immutability |
| Costs | Vitest | retention split, month spread, margin; contracts and progress invoices (rights, above contract, last deleted, retention fixed), payment from the bank in its ledger, acceptances in order, retention released once, audit; budget vs committed, margin with the sales and stock, cash-flow forecast (due, undated, spread) |
| Reports | Vitest | ageing buckets, months of a period; totals, price per m², commercials, ageing, expected collections, stock on a sale half paid; rights; the Excel export's sheets |
| Certificates | Vitest + Chromium | rights, kinds refused (nothing paid, not paid in full, cheque pending), ATT- numbers, frozen snapshot, list visibility, audit, bilingual HTML and one stored PDF, the portal statement (reused the same day, another account refused) |
| Exports | Vitest | workbooks read back with `read-excel-file`: typed cells (dinars, dates, Algiers times), the journal per reader's rights (valid and cancelled, summary), visibility of sales, audit |
| Files | Vitest + SeaweedFS | magic-byte sniffing, file names, `Content-Disposition`, upload size cap and origin check (route helpers), floor plans stored/replaced/removed, presigned download |
| E2E | Playwright, production build, `realestate_e2e` reset + seeded | anonymous redirect, sign-in error, members, org switch, FR→AR RTL, role-based UI; inventory: project → building → generated units → per-m² price list → block → floor plan, read-only commercial, Arabic unit sheet; CRM: lead (flagged duplicate) → call → visit → quotation → PDF by the worker, commercial scope, merge, discount + cancel, targets; sales golden path: lead → option → buyer file → reservation of the optioned unit → sheet PDF → cashier payment → receipt PDF, commercial scope, overdue list; seeded VSP with payment call, bank loan and commission; dashboard sections and overdue link; residence (gestionnaire): next quarter's charge calls → ADC PDF, overdue co-owner → charge receipt RCH PDF, lift ticket resolved, general assembly draft → convocation PDF → attendance with a proxy → votes → closing → PV PDF, announcement published → notice PDF, a supplier invoice's scan, Arabic residence; portal (resident): back office refused, own sale → schedule, receipt and sheet PDFs, co-owned unit's charges, announcements, a ticket reported and received by the gestionnaire, assemblies → PV PDF, published construction reports with their photos, Arabic portal; construction (responsable technique): no sales access, progress report prefilled with the current progress → site photo, internal report kept in the back office, Arabic follow-up; deliveries: list order, appointment → reserve → PV de remise PDF → lifting → PV de levée PDF, unpaid balance warning, Arabic deliveries, dashboard to-dos (next handover, late reserves); rentals (gestionnaire): new lease with its schedule preview → deposit and rent receipts (QIT PDF) → entry inspection PDF → end → deposit settled, overdue rents from the sidebar, Arabic leases; online payment (resident, SATIM stand-in): installment paid by card → result page → REC PDF, declined card with SATIM's message, history; the cashier's list; the gérant's SATIM account (password never shown), Arabic settings; WhatsApp (cashier, Cloud API stand-in): a counter payment → « Paiement reçu » to the consenting buyer, sent by the worker; the gérant's number, webhook and ten templates; Arabic log; exports (cashier): the journal of collections and a filtered sales list, downloaded and read back; imports (gérant): a buyers file checked (issues shown), fixed, imported, found in the list; Arabic page; certificates: the cashier's attestation de versements to a bank → PDF, found on the buyer's portal, the buyer's own relevé → PDF; Arabic sale page; obligations (gérant): dashboard to-dos, an FGCMPI affiliation added to La Corniche's file with its scan, Les Oliviers' insurance to renew, a late Amandiers delivery with its indemnity and missing guarantee, Arabic file; treasury: the cashier's cash desk ledger (seeded expense, transfer, count) and a cash count with an explained difference, « Encaissé sur » in the payment form; the gérant's transfer from the bank to the CCP; Arabic page; costs: the responsable technique records a progress invoice (retention shown) without paying it, the gérant pays the last structural situation from the bank (found in its ledger); Arabic page; reports (gérant): period filter, typologies, commercials, stock, ageing, Excel download read back; Arabic page |

- Vitest `globalSetup` migrates the test DB and creates the S3 bucket once; each test creates its own organization(s) (`tests/factories.ts`, `tests/auth-helpers.ts`) → isolation without truncation.
- The e2e global setup starts `src/jobs/worker.ts` after the reset, waits (up to 300 s) for the documents queued by the seed, and stops its process tree at the end (documents render during e2e).
- E2E specs reuse one session per role (`test.use({ storageState: authFile("salesManager") })`, written by `e2e/auth.setup.ts` through the sign-in API): production builds rate-limit sign-in (3 per 10 s). Only the smoke tests sign in through the form.
- No mocking of the database or RLS. `server-only` is stubbed in Vitest and shimmed for tsx scripts.
- Every service function has at least one integration test; a bug fix starts with a failing test.
- CI: `check` job (`pnpm check`) then `e2e` job; Playwright report uploaded on failure.

## 10. Do / Don't

**Do**
- Go through `withTenant(ctx, …)` for every tenant query; take `orgId` from the session only.
- Check permissions in the service layer (`assertCan`), even if the UI hides the control.
- Issue numbers, write audit and change status inside the same transaction as the business write.
- Use `requireTenantCtx()` in pages, `defineAction` for mutations, `useAction` in client components.
- Enqueue follow-up jobs with `enqueueInTx` inside the business transaction; go through `loadVisibleLead` for anything hanging off a lead and `loadVisibleReservation` for anything hanging off a sale.
- Run `pnpm check` before calling a step done; add FR **and** AR keys together.
- Ask the user before any ambiguous business rule; log the answer in §12.

**Don't**
- Don't import `@/db`, `drizzle-orm`, `pg`, `pg-boss` outside `src/db`, `src/server`, `src/jobs`, `scripts`, `tests`, `e2e`.
- Don't store or compute money as `number`/float; don't `Number()` an amount.
- Don't write `unit.status` outside `transitionUnit()`.
- Don't update/delete payments, receipts or audit rows — cancel with a reason.
- Don't reuse, skip or edit document numbers.
- Don't connect the app as table owner/superuser (RLS bypass); don't add an `organization_id` table to the RLS exemption list.
- Don't cache tenant data without `orgId` in the key.
- Don't `Promise.all` queries on one transaction; don't trust a browser's MIME type (sniff with `checkUpload`).
- Don't interpolate an outer column (`${table.id}`) in a correlated subquery placed in the **select list** of a single-table select: Drizzle renders select-list columns unqualified there (`"id"`), so it binds to the subquery's own column — write `outer_table.id` by hand. `WHERE` clauses and selects with a join are qualified.
- Don't use physical-direction Tailwind classes (`ml-`, `pr-`, `left-`, `text-right`…).
- Don't send email or render PDFs inside a request — enqueue a job.
- Don't edit generated files (`src/db/schema/auth.ts`, applied migrations); regenerate instead.
- Don't commit secrets; `.env*` is git-ignored except `.env.example`.

## 11. Roadmap

**Current: Phases 1 and 2 done (sales; residence management; buyer / resident portal) and modules 4 (construction follow-up & deliveries) and 5 (rentals) of Phase 3, each module with its seed and e2e; online payment by card (SATIM) and WhatsApp notifications, both working against local stand-ins until the promoter's accounts exist (SATIM merchant account, Meta WhatsApp Business). Phase 4 (adoption, from the functional audit): first group done (exports, data import, certificates) and the promoter's obligations (delivery date and indemnity, FGCMPI guarantee, regulatory file, warranties); the treasury (cash desks and accounts) and the construction costs; next the rest of the audit backlog (§13). Then plug in the SATIM and Meta accounts. Steps are committed straight to `main` (§12, 2026-10-04).**

### Phase 0 — Foundations ✅
- [x] `CLAUDE.md` approved (2026-09-30)
- [x] Scaffold: Next 16 + TS 6 strict, ESLint/Prettier, pnpm, git
- [x] Docker Compose: Postgres 18 (dev/test/e2e DBs, 2 roles), SeaweedFS + bucket, Mailpit
- [x] Drizzle, `withTenant`, automatic forced RLS (`post-migrate.sql`), RLS catalog + cross-tenant tests
- [x] Core libs: `Result`/`AppError`, `defineAction`, money + amounts in words FR/AR, dates, `nextDocumentNumber`, `recordAudit`
- [x] Better Auth: email/password, reset, organizations, custom multi-roles, invitations (queued bilingual emails)
- [x] i18n FR/AR + RTL, locale switcher, shared Arabic/Latin font
- [x] App shell: sidebar (start side), org switcher, user menu; members page (invite, roles, remove) with audit
- [x] pg-boss worker + `email.send`
- [x] PDF spike → HTML + Chromium; bilingual receipt template
- [x] CI workflow (`check` + `e2e`)
- [x] Seed: demo promoter (SARL + one user per role) + second SARL; `db:reset`
- [x] Playwright smoke suite

### Phase 1 — MVP
- [x] Module 1 — Projects & inventory
  - [x] Schema: project, building, unit (+ status/price history), price_list (+ items), file; composite tenant FKs
  - [x] Services + 27 integration tests: CRUD with guards, unit generation, `transitionUnit`, block/unblock, price change, price lists (create/edit/apply/discard), floor plans
  - [x] UI: project list/sheet/form, buildings, availability grid with status filter, unit sheet (price/m², histories, floor plan), price-list editor with bulk fill
  - [x] File layer: `/api/files` upload (magic bytes, 20 MB) and presigned download
  - [x] E2E: inventory golden path + read-only commercial + Arabic unit sheet
- [x] Module 2 — Sales CRM
  - [x] Leads: list (search, filters, pagination), form, sheet with timeline, stage/assignment, notes; duplicates flagged, manager merge
  - [x] Pipeline board, follow-ups (overdue/today/upcoming), visits agenda, monthly activity targets
  - [x] Construction milestones (planned) + payment plan templates per project; simulator
  - [x] Quotations: numbered, discount by managers, cancel, bilingual PDF by the worker
  - [x] Commissions and reservation/sales targets (built with module 3)
- [x] Module 3 — Reservation & sale
  - [x] Company sales settings; buyer files with documents checklist; options with automatic expiry
  - [x] Reservations (schedule from the plan, price snapshot, co-buyers), bilingual reservation sheet, contract details and signed scans; VSP with commission
  - [x] Derived statement (FIFO, overdue, advance, penalties shown); payments and receipts (cheques, cancellation, immutability)
  - [x] Milestone validation and payment calls; VSP limit warnings
  - [x] Overdue list, reminder letters, daily 08:00 digest
  - [x] Withdrawal (proposal → approval → refund), transfer, unit swap, bank loans
  - [x] Commissions page (paid, rates per commercial); targets for reservations and VSP
  - [x] Seed and e2e golden path
- [x] Owner dashboard (`/dashboard`): to-do by role, sales, collections, stock, prospection
- [x] Audit log viewer (`/settings/audit`, gérant and comptable)
- [x] Organization settings page (`/settings/company`): legal identity, sales settings, logo printed on documents
- [x] Seed: 2 projects, 3 buildings, ~120 units · leads, visits, follow-ups, plans, quotations, targets · buyers, sales, payments, VSP, loan, calls, reminder

### Phase 2
- [x] Module 6 — Residence management
  - [x] Residences, tantièmes (quote-parts, area split), co-owners and occupants (sales buyers imported)
  - [x] Charge categories and distribution keys; annual budgets (draft → approved)
  - [x] Charge calls per period (ADC, bilingual PDF, cancellation); unit accounts; charge payments and receipts (RCH)
  - [x] Overdue charges: list, reminder letters, digest
  - [x] Suppliers, contracts, invoices (with their scans); budget vs actual and reserve fund balance
  - [x] Staff, attendance, salary advances, monthly pay (net amounts)
  - [x] Tickets (back office; residents through the portal in module 7)
  - [x] General assemblies: agenda, bilingual convocation, attendance and proxies, votes by tantièmes, closing with frozen results, bilingual PV
  - [x] Announcements: drafts, publication with a printable bilingual notice, withdrawal, expiry
  - [x] Seed (delivered « Résidence El Yasmine »: co-owners, charges, calls, payments, overdue, suppliers, staff, tickets, assemblies, announcements) and e2e golden path
- [x] Module 7 — Buyer/resident portal
  - [x] Access: invitations from buyer files and co-owner / occupant records, linking at acceptance, portal shell and home
  - [x] Buyer pages: a sale with its schedule (no penalties), payments and receipts, documents (sheet, scans, payment calls, reminder letters), construction progress and bank loan
  - [x] Residence pages: charges account and assemblies (co-owners); announcements and tickets (co-owners and occupants: report on their unit or the common areas, follow status and assignment — staff comments stay internal)
  - [x] Seed (the demo resident account: its own reservation in Les Oliviers, its co-owner record in El Yasmine) and e2e

### Phase 3
- [x] Module 4 — Construction & delivery
  - [x] Role responsable technique; construction follow-up: progress reports per project (progress per building, site photos), the published ones on the buyers' portal
  - [x] Deliveries: handover appointments, reserves (punch list), numbered bilingual PV de remise des clés → unit delivered (buyers become co-owners of its residence); reserves lifted, PV de levée des réserves; dashboard to-dos, portal
  - [x] Units delivered before the app (delivered project)
  - [x] Seed (progress reports with site photos for Les Oliviers, La Corniche and Les Amandiers; « Résidence Les Amandiers » with handovers at every stage; El Yasmine's units delivered before the app) and e2e
- [x] Module 5 — Rentals
  - [x] Leases of kept units (unit rented, tenant occupant of its residence), rent schedule paid in advance, rent and deposit payments with bilingual quittances (QIT-), corrections, end, renewal with the deposit carried over, deposit settlement, signed lease scan
  - [x] États des lieux (entry / exit, bilingual reports), overdue rents (list, daily digest, dashboard to-dos), leases to renew, unit sheet link
  - [x] Seed (the pharmacy in El Yasmine's kept shop with an overdue quarter, a family at Les Amandiers ending soon, a tenant gone with part of the deposit kept) and e2e
- [x] Online payment (CIB/Edahabia via SATIM)
  - [x] The promoter's SATIM account (encrypted password, test / production platform), portal payment of installments and charges (amount offered, conditions), confirmation with SATIM recorded as payments with receipts, check job, expiry, refunds, payments not recordable flagged
  - [x] Result page and history (portal), staff list with re-check and refund, local SATIM stand-in, seed and e2e
  - [ ] With a SATIM merchant account: run SATIM's test scenarios on the test platform, certification (official CIB / Edahabia logos, conditions validated by the promoter), then production credentials
- [x] WhatsApp Business API notifications
  - [x] The promoter's number (encrypted token and app secret, template language), consent on buyer files, residents and leases, ten notifications queued with their events (payments, calls, reminders, handovers, charges, rent, announcements, assemblies), send job with retries, signed webhook (statuses, « STOP »), message log, local Cloud API stand-in, seed and e2e
  - [ ] With a Meta Business account: a verified business, the WhatsApp number, the ten templates approved, the webhook set up

### Phase 4 — Adoption (functional audit, 2026-10-05)
- [x] Excel exports: journal of collections by period, sales, installments, stock, leads, buyers, residence accounts and residents, leases, supplier invoices; « Exporter (Excel) » on the lists, `/exports` page
- [x] Data import (reprise): units, buyers, ongoing sales with their schedules and past payments, co-owners and shares — templates, checks, then all-or-nothing import
- [x] Certificates for banks and buyers: attestation de réservation, de versements, de paiement intégral, d'avancement des travaux, relevé de compte (numbered `ATT-`, bilingual, frozen at issue; on the portal, with the buyer's own relevé)
- [x] Promoter's obligations (Loi 11-04): contractual delivery date with the late-delivery indemnity (shown), FGCMPI guarantee per sale and membership number, regulatory file per project (validity, scans, dashboard alerts), warranties after delivery; seed and e2e
- [x] Treasury: cash desks, bank and CCP accounts, every collection on an account (default per method), movements and transfers, ledgers with running balance and Excel export, cash counts; seed and e2e
- [x] Reports: sales by month, project and typology, commercials, receivables by age, expected collections, stock; Excel export
- [x] Construction costs: budget per project, contractors' contracts, progress invoices with retention, payments from an account, réceptions and retention release, margin, 12-month cash-flow forecast; seed and e2e

## 12. Decisions log

| Date | Decision |
|---|---|
| 2026-09-30 | TypeScript pinned to 6.0.x: npm `latest` is 7.0 (native compiler) but `typescript-eslint` (via `eslint-config-next`) supports `<6.1`. Revisit when it does. |
| 2026-09-30 | Versions follow `create-next-app@16.3.7` where it pins them (React 19.2.8, ESLint 9). |
| 2026-09-30 | Drizzle 0.45.x (stable); 1.0 is still RC — migrate when stable. |
| 2026-09-30 | PostgreSQL 18 (native `uuidv7()`), host port 5433 (5432 often taken by a local install). |
| 2026-09-30 | SeaweedFS replaces MinIO for local S3 (`minio/minio` no longer published). App code only uses the S3 API. |
| 2026-09-30 | Mailpit + nodemailer for email; emails always go through the `email.send` queue. |
| 2026-09-30 | Money as JS `bigint` end-to-end; rates in basis points; splits via largest-remainder `allocate()`; `formatDZD` uses U+00A0 (U+202F missing from fonts). |
| 2026-09-30 | Two DB roles (owner / app); RLS forced and applied automatically to every `organization_id` table by `post-migrate.sql`; `member`/`invitation` exempt. |
| 2026-09-30 | pg-boss: separate worker process; `pgboss` schema owned by the app role, installed by `db:migrate`. |
| 2026-09-30 | Calendar dates as `date`/`CalendarDate`, instants as `timestamptz`. |
| 2026-09-30 | Copropriétaire → `co_owner` (the `owner` role name is taken). |
| 2026-09-30 | Members may hold several roles; the `owner` role is only granted at organization creation and is locked. |
| 2026-09-30 | Better Auth IDs: random UUID v4 (unguessable invitation links); domain tables `uuidv7()`. |
| 2026-09-30 | **PDF engine: HTML → headless Chromium (`playwright-core`)**, replacing `@react-pdf/renderer`: the spike showed correct Arabic shaping but wrong mixed Arabic/Latin order (e.g. cheque number and bank swapped) and overlapping columns. Chromium must be installed where PDFs render. |
| 2026-09-30 | One font family (IBM Plex Sans Arabic, OFL) for UI and PDFs, self-hosted. |
| 2026-09-30 | Auth emails are bilingual (FR then AR) in a single message. |
| 2026-09-30 | Member management via our service (permission + owner lock + audit with actor) calling Better Auth's server API. |
| 2026-09-30 | `@swc/core` (loaded by the next-intl plugin) refuses a native-binding cache under a `%LOCALAPPDATA%` that grants write access to sandbox SIDs: `next.config.ts` sets `SWC_NATIVE_BINDING_CACHE` to `node_modules/.cache/swc` first. |
| 2026-09-30 | Source files may not contain invisible/bidi-control characters (`scripts/check-source-chars.ts`). |
| 2026-09-30 | Phase 0 seed = demo SARL with one user per role + a second SARL for the gérant; business data seeded with each Phase 1 module. |
| 2026-09-30 | **Pricing model**: `unit.list_price` (current) + versioned per-project `price_list` drafts applied in one go; per-unit `unit_price_history`; one-off changes need a reason. Reservations will snapshot the price. |
| 2026-09-30 | Tenant child→parent FKs are composite `(organization_id, parent_id)` with explicit short names (63-char identifier limit); FK checks bypass RLS. |
| 2026-09-30 | `unit_status_history`, `unit_price_history` append-only through grants (like `audit_log`). |
| 2026-09-30 | Project `wilaya`/`commune` are free text for now; the global reference tables come with the first form that needs a strict list (CRM / buyer addresses). |
| 2026-09-30 | TanStack Table deferred: module 1 lists are small and unpaginated (shadcn `Table`); install it with the paginated leads list. |
| 2026-09-30 | **Uploads go through our Route Handler** (not presigned PUT) so the server checks size and magic bytes before storing; downloads are a 302 to a 5-min presigned GET. Replaced/removed files are soft-deleted, objects kept. |
| 2026-09-30 | Better Auth's production rate limit stays on (sign-in 3 per 10 s); forms show a "too many attempts" message; e2e signs in once per role through the API. |
| 2026-09-30 | CI runs SeaweedFS as a `docker run` step (service containers cannot take a command); test setups create the bucket (`waitForBucket`). |
| 2026-09-30 | **CRM duplicates (user)**: a lead whose phone matches another live lead is **allowed and flagged** as a possible duplicate (derived, not stored); managers merge duplicates later. |
| 2026-09-30 | **Pipeline (user)**: one fixed stage list for every company: `new` → `contacted` → `visit_scheduled` → `visited` → `negotiation` → `won` / `lost` (lost needs a reason). |
| 2026-09-30 | **Discounts (user)**: only the directeur commercial and the gérant can put a discount on a quotation (`quotation:discount`). |
| 2026-09-30 | **Commissions (user)**: decided and built with module 3 (their triggers are reservation / VSP / payments). Module 2 sales targets count activity (visits, quotations). |
| 2026-09-30 | **Lead assignment (user)**: a commercial owns the leads they create and sees only theirs; managers see all, assign/reassign by hand, and may leave leads unassigned. |
| 2026-09-30 | **Simulator (user)**: payment plans are per-project templates (share per step: at signing, N months after signing, or at a construction milestone); the simulator and module 3 schedules use the same model. |
| 2026-09-30 | **Quotations (user)**: bilingual FR + AR on one document; validity is a company setting, default 15 days. |
| 2026-09-30 | Leads keep one `full_name` (prospects rarely give more); the buyer file (module 3) will hold the structured legal identity. |
| 2026-09-30 | Quotations only for `available`/`optioned` priced units; the schedule assumes signing on the issue day (milestone dates = planned dates, printed as provisional). |
| 2026-09-30 | Jobs that follow a write are enqueued inside the transaction (`enqueueInTx`, pg-boss `fromDrizzle`), with the record id as `singletonKey`; handlers are idempotent. |
| 2026-09-30 | `db:migrate` starts pg-boss with the scheduler on so its internal `__pgboss__send-it` queue exists before the first worker (otherwise the worker logs "does not exist" while its cache catches up). |
| 2026-09-30 | Demo seed has a second commercial (Lina Saadi) to exercise assignment and commercial scoping. |
| 2026-10-01 | **Options (user)**: default 24 h (company setting), no limit per prospect; one active option per unit; only the holder's lead can reserve an optioned unit; expiry releases the unit automatically (job scheduled when the option is placed). |
| 2026-10-01 | **Payment allocation (user)**: oldest due first; what exceeds the amount currently due goes to the next installments (shown as an advance); a payment above the remaining balance of the sale is refused. Allocation is derived (FIFO over installments by due date, then position), never stored; a receipt prints the allocation at issue. |
| 2026-10-01 | **Cheques (user)**: receipt issued at reception, marked « sous réserve d'encaissement »; a bounced cheque = the accountant cancels the payment (and its receipt) with the reason, the installments are due again. |
| 2026-10-01 | **Late-payment penalties (user)**: company settings (monthly rate on the overdue amount, grace days, cap as % of the installment), 0 % = off by default; computed and shown on statements and reminder letters, never charged automatically. |
| 2026-10-01 | **Withdrawal (user)**: company default retention % of the amount paid, prefilled and editable with a reason, proposed by the directeur commercial and approved by the gérant; the unit becomes available; refund = paid − retention, recorded when paid out. |
| 2026-10-01 | **VSP limits (user)**: warnings only, from cumulative limits per construction stage configured in company settings (empty = no check); nothing from décret 13-431 is hard-coded. |
| 2026-10-01 | **Commissions (user)**: % of the net price, earned at VSP signing; company default rate, overridable per commercial; the commercial is the lead's owner at reservation; cancelled if the sale is undone. |
| 2026-10-01 | **VAT (user)**: list prices are TTC; no VAT computation or line on documents. |
| 2026-10-01 | **Contracts (user)**: reservation and VSP are recorded (date, notary, reference) with the signed scans attached; the app prints an internal bilingual reservation sheet for the notary, not the legal contract. |
| 2026-10-01 | **Documents language (user)**: receipts, reservation sheets, payment calls and reminder letters are bilingual FR + AR. |
| 2026-10-01 | **Reminders (user)**: overdue list, daily 08:00 (Algiers) digest e-mail to cashiers and the directeur commercial, printable bilingual reminder letter per buyer; WhatsApp/SMS in Phase 3. |
| 2026-10-01 | **Buyer file (user)**: document checklist (missing / received / verified, optional scan), never blocking; missing items highlighted on the reservation and the VSP. |
| 2026-10-01 | One generic `pdf.document` queue (`{ kind, id }`) replaces `pdf.quotation`; every sale document is filed under its `reservation` so file readers follow the sale's visibility; a missing PDF can be requested again from the page. |
| 2026-10-01 | A milestone installment falls due on the validation date + the company payment-call delay, **never before the reservation date** (a milestone already reached when the buyer signs is due at signing). Validation is final. |
| 2026-10-01 | Payment calls: one numbered call per installment of the validated milestone with something left to pay (advances deducted), issued by a job; immutable once issued. |
| 2026-10-01 | Reminder letters are issued on demand (`sale:remind`: gérant, directeur commercial, comptable, caissier) with an editable pay-by date (default 8 days); their overdue lines and penalties are kept as printed. The daily digest goes to cashiers and sales managers, only when something is overdue, at most once a day per recipient (throttled jobs: pg-boss standard queues ignore a bare `singletonKey`). |
| 2026-10-01 | Withdrawal, transfer and unit swap apply to reservations before the VSP only; a swap stays within the project and keeps the reservation number (a new reservation sheet is rendered). Withdrawal approval recomputes the amounts on what is paid at that moment; payments stay valid and the refund is recorded separately. |
| 2026-10-01 | Bank loans: one followed loan per sale; disbursements are recorded as payments with method `bank_loan` (no separate disbursement table). |
| 2026-10-01 | Per-commercial commission rates are set by the gérant (`organization:update`); accountants mark commissions paid; each commission keeps the rate it was earned at. Monthly targets also count reservations signed (not withdrawn) and VSP signed, credited to the sale's commercial. |
| 2026-10-01 | Dashboard = one page whose sections follow the member's permissions (and the sale/lead visibility), not one dashboard per role. Figures are derived on the fly (no snapshots); "this month" is the Algiers calendar month. |
| 2026-10-01 | Audit log viewer for `audit:read` (gérant, comptable); details show the stored JSON as is (amounts in centimes, rates in basis points). |
| 2026-10-01 | Company logo: PNG/JPEG only (no SVG: scripts), 2 MB, stored like other files; printed on documents issued after the upload (issued PDFs are never re-rendered). |
| 2026-10-01 | **Residence management (user)**: run by the promoter's own service (same organization, `property_manager` role); a residence is set up on a project, its co-owners come from the buyers of sold units or are entered by hand (residences delivered before the app). Handover (module 4) stays in Phase 3. |
| 2026-10-01 | **Charges (user)**: annual budget per residence, then calls of provisions at a frequency set per residence (monthly, quarterly, half-yearly, yearly); default distribution key = tantièmes (a category can use equal, per building or a custom unit list); charges are always billed to the co-owner (never the occupant). |
| 2026-10-01 | **Charges collection (user)**: overdue charges get reminders only (list, letters, digest), never penalties; a reserve fund = % of the annual budget per residence, added to each call and tracked as a balance (0 % = none); charge receipts have their own numbering `RCH-` (separate from sales receipts `REC-`). |
| 2026-10-01 | **Residence operations (user)**: suppliers, contracts and invoices booked to charge categories with a budget vs actual report; staff files, attendance, salary advances and monthly pay entered as net amounts (no IRG/CNAS computation); tickets opened by residents (portal, module 7) and staff, assigned to staff or a supplier; full general assemblies (bilingual convocation, attendance and proxies, votes by tantièmes with a majority chosen per resolution, bilingual PV). |

| 2026-10-02 | A residence's units start from their inventory quote-part (`unit.share`); the area split uses the living area, else the usable area (shops, offices, parking, storage). |
| 2026-10-02 | Budgets are approved by the gestionnaire (`charge:create`) until general assemblies exist; approval freezes the frequency and reserve fund rate; next year's draft starts from the last approved budget. |
| 2026-10-02 | Charge calls are addressed to the main co-owner on the issue day; a unit without co-owner gets its call addressed to the promoter (« lot non attribué »). A wrong issue is cancelled by an accountant with a reason and the period issued again. |
| 2026-10-04 | Charge payments may exceed what has been called: the excess is an advance for the next calls (derived, FIFO); no penalties on charges. The reserve fund collected is derived pro rata of each call's payments. |
| 2026-10-04 | Overdue charges: reminder letters by `charge:remind` (gérant, comptable, caissier, gestionnaire), pay-by date 8 days by default; the daily digest goes to property managers and cashiers and rides on the existing `reminders.digest` job (one job per organization and day). |
| 2026-10-04 | Suppliers are shared by the organization's residences. An invoice is booked to one charge category of its residence or to the reserve fund (works); spending counts at the invoice date, paid or not ("dont payé" shown apart); the reserve fund balance = collected − works invoices. Invoices are read-only once paid. |
| 2026-10-04 | Staff: one residence per agent; pay is one record per agent and month (net amounts), its cost (base + bonus − deduction) counts in the budget vs actual of the agent's category; advances are deducted from the month they are assigned to and locked once that month's pay is recorded. |
| 2026-10-04 | Tickets have no number (title + date); the list shows active tickets (open, in progress) by default, urgent first; no e-mail notifications yet. |
| 2026-10-04 | **Workflow (user)**: each finished step is committed and pushed straight to `main` (after `pnpm check`); no feature branches or PRs. |
| 2026-10-04 | General assemblies: votes are recorded per unit (one vote per unit, weighted by its tantièmes); the promoter votes for the units it still owns; absent units count in the total of the absolute / two-thirds / unanimity majorities. No quorum rule is encoded (nothing verified in law yet): the share present or represented is shown and printed on the PV. |
| 2026-10-04 | An assembly is closed from its meeting day only, once the attendance is recorded; closing freezes the sheet (tantièmes and co-owners as on that day), tallies and results, and is final (no reopening). Drafts can be deleted (hard delete: nothing was sent); a convened assembly cannot be cancelled yet (a postponed meeting = a new assembly; cancellation / PV de carence later if needed). |
| 2026-10-04 | The PV names the units that voted against or abstained on each resolution and carries the attendance sheet as an annex; the convocation and the PV are filed under the residence. |
| 2026-10-04 | Announcements: per residence, written as drafts by the gérant or the gestionnaire; publishing renders a bilingual notice to post in the building and (module 7) shows it on the residents' portal; published announcements no longer change (withdraw and rewrite instead); an optional last day hides them automatically. No e-mail or SMS to residents (WhatsApp is Phase 3). |
| 2026-10-05 | Demo residence: a separate project delivered in 2023, before the app (« Résidence El Yasmine », status `delivered`), whose units are **blocked** with that reason so they never count as stock for sale, and whose co-owners are entered by hand. Product gap to settle with module 4: a project delivered before the app has no unit status of its own (`delivered` only comes from a handover). |
| 2026-10-05 | **Portal access (user)**: by invitation from the back office only — staff invite a buyer file or a co-owner / occupant record; the bilingual e-mail creates the account (role `resident`) already linked to that record. |
| 2026-10-05 | **Portal content (user)**: buyers see their schedule and payments (receipts), sale documents (reservation sheet, payment calls, reminder letters, signed scans), construction progress and their bank loan's stage; co-owners see their charges account (calls, payments, receipts, reminder letters), announcements, tickets (open and follow) and general assemblies (convocations, PVs); **occupants** get a limited access: announcements and tickets only. |
| 2026-10-05 | Portal invitations are created by our service (a Better Auth invitation row with role `resident`) rather than Better Auth's API, so the directeur commercial and the gestionnaire can invite without the staff `invitation:create` right; portal accounts and invitations are kept off the members page. |
| 2026-10-05 | **Rentals (recommended, user delegated: "if there are questions, do what you recommend")**: the promoter rents the units it keeps (available, or blocked as kept by the company) — residential or commercial leases with a tenant (person or company), a duration in months, a monthly rent plus an optional charges provision, paid in advance monthly, quarterly, half-yearly or yearly, and a deposit. No penalties on late rent (reminders only, like charges). The app keeps the lease and its money; the lease contract itself is the signed scan (no generated contract: legal text, notary for commercial leases). |
| 2026-10-05 | Rent receipts: one numbering `QIT-` for quittances and deposit receipts, bilingual, filed under the lease. Leases numbered `BAL-`. `lease:update` for the gérant, the directeur commercial and the gestionnaire; rent is collected by whoever records payments (`payment:create`) and cancelled by accountants. A lease's terms are fixed once money is received (a rent change = a renewal). |
| 2026-10-05 | A renewal is a new lease starting the day after the term, the deposit held carried over; ending a lease early drops the periods not started (no prorata); a tenant of a unit in a residence is its main occupant for the lease (portal: announcements and tickets once invited). Rent accounts are not on the portal yet. |
| 2026-10-05 | États des lieux: one entry and one exit per lease, final once recorded (no edit), the exit report printing each element's entry condition. Rentals alerts ride on the daily digest (property managers and cashiers): overdue rents and leases ending within 30 days; the dashboard flags terms within 60 days. |
| 2026-10-05 | Demo rentals: El Yasmine's kept shop (Y-00-02) is leased to a pharmacy (quarterly, current quarter overdue), Les Amandiers' D-03-03 to a family (monthly, paid to date, term within 60 days) and D-00-03 was left last spring (exit inspection, part of the deposit kept); their tenants are the units' occupants. |
| 2026-10-05 | The members page no longer offers the portal role `resident`: a staff invitation with it created a portal account linked to no record (and hidden from the pending invitations), and giving it to a staff member made them portal-only. Staff forms and their schema use `staffRoles`; `invitableRoles` is gone. |
| 2026-10-05 | **Module 4 scope (user: "answer the questions with what you recommend")**: construction follow-up = dated progress reports per project (text FR, Arabic optional; progress in % per building; site photos), published to the buyers or kept internal; the existing milestones keep driving the payment calls. Delivery = per sold unit: appointment, reserves (punch list), numbered bilingual PV de remise des clés → unit `delivered`, reserves lifted then a PV de levée des réserves. |
| 2026-10-05 | New role `technical_manager` (Responsable technique): construction follow-up and deliveries, projects read-only, no access to sales, buyer files or payments. `construction:read` for every staff role, `construction:update` for the gérant and the responsable technique (milestone validation stays with the gérant and the directeur commercial: it issues payment calls). |
| 2026-10-05 | Buyers see their building's progress from published reports only, plus the project's latest 10 published reports with their photos (every building). Site photos: JPEG/PNG/WebP, 10 MB, 20 per report. |
| 2026-10-05 | **Deliveries (recommended, user delegated)**: one handover per sold unit (VSP signed); the appointment is not e-mailed (portal, WhatsApp later); reserves noted at the visit or after it, until a PV de levée closes them; the PV de remise is numbered `PVL-`, final, and makes the unit `delivered`; a sale not fully paid can still be handed over — the PV shows what remains (warning in the form, never blocking, like the VSP limits). |
| 2026-10-05 | A project is "ready" for handovers when it is `delivered` or its handover-stage milestone is validated; before that its sold units show as "travaux en cours" in the deliveries list (sorting only). Deliveries are visible organization-wide to `handover:read` (not to commercials, who see the unit status). Delivery PVs are filed under their handover (entity `handover`) so the responsable technique, without access to sales, reads them. |
| 2026-10-05 | At the handover PV, the buyers become co-owners of the unit's residence (when the unit has none) from the PV date — the same rule as the import from sales, which keeps the VSP date. |
| 2026-10-05 | Demo data for module 4: « Résidence Les Amandiers » (AMND, finished this month, its « Remise des clés » milestone validated): five sales — one delivered with its reserves closed, one delivered with open reserves (one late), one appointment, two to schedule (one not fully paid) — and its residence, whose co-owners come from the handovers; El Yasmine's sold units are now `delivered` before the app, the shop the company kept stays blocked. Site photos are drawn by the seed (`photos.ts`, PNG via `node:zlib`, no dependency). |
| 2026-10-05 | **Units sold before the app** (settles the gap of the demo residence): in a `delivered` project, `available` / `blocked` units can be marked `delivered` with a reason (new transitions, used by `recordPastDeliveries` only); units still owned by the promoter keep their status. |
| 2026-10-05 | **Online payment (recommended, user delegated; no credentials yet)**: each promoter is paid on its own SATIM merchant account (CIB and Edahabia), set up by the gérant — the SaaS never holds the money. The portal lets buyers pay their installments and co-owners their charges, any amount from 50 DA to the remaining balance (offered: what is due); rent stays off the portal. A confirmed payment is recorded like a counter payment (method `card`, receipt REC- / RCH-) by the paying account. |
| 2026-10-05 | SATIM is called through its public REST API (`register.do`, `confirmOrder.do`, `refund.do`, POST form-encoded, `orderNumber` of 10 digits, amount in centimes, currency 012, `force_terminal_id` and `udf1` in `jsonParams`), built and tested against a local stand-in: to check against SATIM's integration kit once a merchant account exists. Only `confirmOrder.do` decides; a payment SATIM confirms but the rules refuse is kept for a refund (never lost, never forced); test platform payments are recorded with receipts (marked « Test »), cancelled afterwards. |
| 2026-10-05 | Organization secrets (SATIM password, later the WhatsApp token) are encrypted with AES-256-GCM under `SECRETS_KEY` (derived from `BETTER_AUTH_SECRET` when absent). Payment conditions shown to payers are a generic text (SATIM's process, allocation, refunds, SATIM's 3020, loi 18-07) for the promoter's lawyer to validate. |
| 2026-10-05 | **WhatsApp (recommended, user delegated; no credentials yet)**: each promoter sends from its own WhatsApp Business number (Cloud API), set up by the gérant; ten template notifications (payment received, appel de fonds, sales reminder, handover appointment, charge call, charge payment, charge reminder, rent received, announcement, assembly convened), each switched on once Meta approves its template; one template language per organization (French or Arabic) rather than a per-contact language. |
| 2026-10-05 | WhatsApp messages only go to people whose consent staff recorded (buyer file, resident, lease; co-owners from a sale and lease occupants inherit it), mobiles only; « STOP » withdraws it. Messages are queued in the event's transaction and sent by the worker; a sending problem never blocks the business event. The webhook trusts only calls signed with the app secret. |
| 2026-10-05 | **Functional audit (user asked)**: first group built for adoption — Excel exports, data import, certificates for banks and buyers; then money controls (cash desk, construction costs), legal exposure (delivery penalties, FGCMPI, warranties), then syndic, rentals and commercial depth. |
| 2026-10-05 | **Data import (recommended, user delegated)**: Excel templates per kind (units, buyers, ongoing sales with schedules and payments, co-owners and shares), checked row by row before anything is written, then imported all or nothing through the same services; rows already present are left aside with a warning. Imported sales keep their own dates (RES- / VSP- numbered at those dates) and earn no commission; their past payments keep the previous system's receipt numbers — no REC- receipt for money received before the app, nobody is notified. |
| 2026-10-06 | **Treasury (recommended, user delegated)**: one table of accounts (cash desk, bank, CCP) with an opening balance and one default per kind; every collection lands on an account — the one chosen in the form, else the default of its method's kind — so balances are derived from the collections themselves, with manual movements only for what is recorded nowhere else (expenses, other income, fees, transfers). Cash counts book their difference as an adjustment (explained, final). An account closes only when empty. Movements are immutable (cancelled with a reason, both sides of a transfer). |
| 2026-10-06 | **Construction costs (recommended, user delegated)**: contractors and design offices are the organization's suppliers; one contract per lot with a retention of guarantee (5 % by default) kept on each progress invoice and released once after the réception définitive; progress invoices are paid from a treasury account by the gérant or the comptable, recorded by the responsable technique. The margin compares the expected revenue (sales signed + unsold stock at list price) with the forecast cost (per category, the larger of budget and commitments); the cash-flow forecast spreads what remains to invoice evenly to each contract's planned end. Costs and margins are hidden from the sales team. |
| 2026-10-06 | **Audit backlog (user)**: every item of the functional audit is listed in §13 with its state, checked as it is finished. |
| 2026-10-06 | **Promoter's obligations (recommended, user delegated)**: the contractual delivery date is snapshotted from the project's planned delivery and corrected per contract; the late-delivery indemnity owed to buyers is a company setting (monthly % of the price, cap; 0 % by default) shown on the sale and never booked; the FGCMPI guarantee certificate is recorded per sale (warning when missing on a sold sale); each project keeps a regulatory file of typed documents with expiry alerts (60 days) and a checklist of five essentials (title, building permit, CTC, insurance, FGCMPI) — warnings only, nothing blocks a sale. |
| 2026-10-05 | **Certificates (recommended, user delegated)**: five documents on a sale — attestations de réservation, de versements, de paiement intégral (refused while anything remains or a cheque awaits clearance), d'avancement des travaux, and the relevé de compte — numbered `ATT-` (one sequence), bilingual, optionally addressed to a bank, content frozen at issue, issued by the gérant, the directeur commercial, the comptable and the caissier. Buyers download them from the portal and draw their own relevé there (unsigned, reused the same day); attestations stay staff-issued because banks want them signed and stamped. |
| 2026-10-05 | Exports are .xlsx (not CSV: Arabic text and French number formats survive) built server side with `write-excel-file`, imports read with `read-excel-file` (both maintained, only `fflate` beneath; `exceljs` is unmaintained). Amounts become dinars as numbers only in spreadsheet cells; exports follow each list's filters and rights and are audited. |

### Open items
- **WhatsApp**: needs the promoter's Meta Business account (verified), a WhatsApp Business number, the ten templates approved in WhatsApp Manager (texts on the settings page) and the webhook set up with the app secret.
- **Online payment**: needs the promoter's SATIM merchant account (through its bank) — test credentials, then SATIM's test scenarios and certification (official logos, conditions) before production credentials.
- **GitHub**: repo `yurigami1939-oss/realestate` is **public** — make it private before real client data or configuration lands. Steps are committed straight to `main` (CI runs on every push).

### Open business questions (ask before implementing)
- Hosting location (Loi 18-07 restricts cross-border transfer of personal data).
- Cumulative VSP payment limits per construction stage (décret 13-431), to configure once the notary confirms them.

## 13. Functional audit backlog (2026-10-05)

Every item of the functional audit (what an Algerian promoter, its syndic and its rentals activity still miss), checked when finished. Legal points (rates, deadlines, FGCMPI rules, VAT) are confirmed with a notary or lawyer before being encoded (§10).

### Priority 1 — blocking for adoption or legal exposure
- [x] **1. Importing existing data**: Excel templates and import wizards (row checks, all or nothing) for units, buyers, ongoing sales with their schedules and past payments, co-owners and shares.
- [ ] **2. Excel exports and an accounting export**
  - [x] Excel export of every list, the journal of collections (date, method, account) and each account's ledger
  - [ ] Accounting export for the chartered accountant (SCF entries: sales, charge calls, collections) and G50 tax return figures
- [x] **3. Certificates for banks and buyers**: attestation de réservation, de versements, de solde (paiement intégral), relevé de compte, attestation d'avancement des travaux; numbered, bilingual, downloadable from the portal.
- [x] **4. The promoter's obligations under Loi 11-04 and décret 13-431**
  - [x] Contractual delivery date per sale and the late-delivery indemnity owed to the buyer (shown)
  - [x] FGCMPI guarantee certificate per VSP (number, date, scan) and the membership number
  - [x] FGCMPI premium per guarantee
  - [x] Project regulatory file with expiry alerts (title, permits, CTC, RC insurance, FGCMPI, certificat de conformité)
  - [x] Règlement de copropriété and état descriptif de division (décret 14-99 model), décennale and CAT-NAT insurance as their own document kinds
- [x] **5. Construction costs and contractors**
  - [x] Project budget (land, studies, works, utility networks VRD, fees)
  - [x] Contracts with contractors and design offices
  - [x] Contractors' progress invoices (situations de travaux), 5 % retention, payments
  - [x] Acceptance of works from contractors (réception provisoire / définitive), retention released
  - [x] Cash-flow forecast (expected collections from the schedules against expected spending)
  - [x] Margin per project
- [ ] **6. Cash desk and banks**
  - [x] Cash desks, bank and CCP accounts per company; every collection on an account; movements and transfers; ledgers
  - [x] Cash journal with daily closing (arrêté de caisse)
  - [ ] Cheque deposit slips (bordereaux de remise de chèques)
  - [ ] Bank statement import and reconciliation
  - [x] Supplier invoices and contractors paid from an account
  - [ ] Staff pay, withdrawal and deposit refunds paid from an account

### Priority 2 — important for daily operations
- [ ] **7. Changes to a sale**
  - [ ] Rescheduling the installment plan by amendment
  - [ ] Several units in one contract (flat + parking + cellar)
  - [ ] Termination by the promoter for non-payment (formal notices, then termination with retention)
  - [ ] Discount requests from a commercial to a manager
- [ ] **8. Financing sources**
  - [ ] LPA with CNL aid and eligibility checks (income ceilings, no prior property), subsidised-rate loans
  - [ ] FNPOS or employer aid, Islamic financing (Mourabaha)
  - [ ] Financing plan per sale (own funds, bank, aid) with expected vs received
- [ ] **9. Post-delivery warranties**
  - [x] Warranty end dates (parfait achèvement, décennale) on the sale and the portal
  - [ ] Warranty claims from buyers through the portal, passed to the contractor, with deadlines (incl. bon fonctionnement)
- [ ] **10. Syndic depth**
  - [ ] Exceptional calls for works voted in general assembly
  - [ ] Individual water meters and consumption-based charges
  - [ ] Repayment plans for arrears and a recovery procedure (formal notice, bailiff, injonction de payer)
  - [ ] Building insurance, regulatory inspections (lifts, extinguishers, civil protection), preventive maintenance calendar
  - [ ] Accounts approval pack for the general assembly, access for the residents' council
  - [ ] Residences not built by the company (third-party buildings)
- [ ] **11. Rentals depth**
  - [ ] Annual rent revision and yearly settlement of tenants' charges
  - [ ] Lease registration, rental taxes, guarantors
  - [ ] Management mandates for other owners (owner statements, fees, payouts)
  - [ ] Tenant portal with online rent payment
- [ ] **12. Client communication**
  - [ ] SMS through Mobilis, Djezzy or Ooredoo
  - [ ] E-mailing receipts and payment calls to clients
  - [ ] Buyers uploading their documents from the portal
  - [ ] Requests from the portal (appointment, certificate)
- [ ] **13. Lead capture and partners**
  - [x] Excel / CSV import of leads (Facebook Lead Ads exports, website form exports)
  - [ ] Live capture: website / project page forms, Facebook Lead Ads webhook
  - [ ] Shareable unit sheet as a PDF (plan, price, availability)
  - [ ] Outside agencies and business introducers with their commissions
  - [ ] Cost and return per lead source
- [ ] **14. Reporting**
  - [x] Sales by period, project and typology
  - [x] Receivables by age and collections forecast by month
  - [x] Stock value, commercial performance
  - [ ] Consolidated view across the gérant's companies

### Priority 3 — platform and nice-to-have
- [ ] **15. Security and Loi 18-07**: two-factor authentication (gérant, comptable); individuals' requests (export, correction, erasure), retention periods, register of processing; consent beyond WhatsApp, logging who reads personal data.
- [ ] **16. Configuration**: custom roles per company, editable wording on documents, reference list of wilayas and communes.
- [ ] **17. Mobile**: installable app and push notifications for field staff and residents.
- [ ] **18. Extras**: estimated notary fees and registration duties on quotations; payments from the diaspora (currency, exchange rate); electronic signature (loi 15-04); virtual tours, booking of common rooms, visitor management.
