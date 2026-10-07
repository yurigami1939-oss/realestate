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
| QR codes | `uqr` (SVG, two-factor setup) | 0.1.3 |
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
│                             # auth schema generation, shims/server-only.mjs, swc-native-cache.ts,
│                             # generate-icons.ts (the app icons in public/, committed)
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
    │   │   ├── (auth)/       # sign-in, two-factor (code), sign-up, forgot/reset password, onboarding,
    │   │   │                 # accept-invitation; settings/security (2FA) lives in (app)
    │   │   ├── (app)/        # back-office shell (guard + sidebar) · dashboard · settings (members,
    │   │   │                 # company + logo, audit log) · projects · construction · leads · buyers · sales
    │   │   │                 # · commissions · deliveries · rentals · residences · online-payments
    │   │   │                 # · settings/online-payment (SATIM account) · whatsapp (message log)
    │   │   │                 # · settings/whatsapp (number, webhook, templates) · exports (Excel exports)
    │   │   │                 # · imports (reprise de données: templates, check, import)
    │   │   │                 # · treasury (cash desks and accounts, ledgers, cash counts,
    │   │   │                 #   [accountId]/reconciliation: bank statements matched with the ledger)
    │   │   │                 # · projects/[id]/costs (budget, contracts, progress invoices, margin, forecast)
    │   │   │                 # · reports (sales, commercials, receivables by age, expected collections, stock)
    │   │   │                 # · group (a gérant's companies side by side)
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
    │   ├── manifest.ts       # web app manifest: installable app (standalone, icons in public/)
    │   └── fonts.ts          # next/font/local for the shared font
    ├── components/
    │   ├── ui/               # shadcn/ui primitives (generated; sidebar labels made translatable)
    │   ├── app-shell/        # sidebar, org switcher, user menu
    │   ├── forms/            # TextField, fields, FormDialog, ConfirmAction, useAction, useTranslateKey
    │   ├── files/            # UploadButton (posts to /api/files)
    │   ├── data-table/       # DataTable (TanStack columns), Pagination (links), useSearchParamsState
    │   ├── crm/              # stage/visit badges, phone text + call/WhatsApp, follow-up/visit dialogs
    │   ├── discounts/        # request / decide dialogs, state badge, managers' list filters
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
    │   └── auth/ · i18n/     # sign-out, TwoFactorSettings (enable / disable, QR, backup codes), locale switcher
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
    │   ├── email/            # transport, send-later (queue), bilingual templates, client-documents.ts
    │   │                     # (receipts and calls e-mailed to clients with their PDF)
    │   ├── files/            # s3.ts (client, ensureBucket), storage.ts (keys, put, presign),
    │   │                     # service.ts (checkUpload, storeFile, discardFile, getFileDownloadUrl)
    │   ├── route-handler.ts  # jsonResult, assertSameOrigin, readFormData (size-capped)
    │   ├── organizations/    # members & invitations; settings.ts (legal identity, sales settings, logo,
    │   │                     # loadCompanyLetterhead for documents)
    │   ├── inventory/        # projects, buildings, units, price lists, floor plans, transitionUnit
    │   ├── crm/              # leads, visits, follow-ups, merge, targets; access.ts (lead visibility)
    │   ├── discounts/        # discount requests: commercial asks, manager decides; assertDiscountAllowed
    │   ├── payment-plans/    # construction milestones (planned, stage) and payment plan templates
    │   ├── construction/     # construction follow-up: progress reports, building progress, site photos
    │   ├── rentals/          # leases and états des lieux (service.ts), derived rent account (accounts.ts),
    │   │                     # quittances and inspection reports (documents.ts), overdue rents, digest.ts
    │   ├── handovers/        # deliveries: appointments, reserves, PV de remise des clés (unit delivered),
    │   │                     # PV de levée des réserves (documents.ts), units delivered before the app
    │   ├── quotations/       # issue/cancel, queries, pdf.ts (job: render + store once)
    │   ├── buyers/           # buyer files, documents checklist; access.ts (buyer visibility)
    │   ├── sales/            # options, reservations + VSP (reservations.ts), sale queries, withdrawals,
    │   │                     # transfers + unit swaps (changes.ts), avenants (amendments.ts + PDF), bank loans,
    │   │                     # documents; access.ts
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
    │   ├── maintenance/      # a residence's insurance, regulatory inspections and maintenance (checks, visits)
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
    │   │                     # resolvePaymentAccount), balances.ts (balances from every flow), queries.ts (ledger),
    │   │                     # deposits.ts (cheque deposit slips; their PDF in documents.ts),
    │   │                     # reconciliation.ts (bank statements matched with ledger entries)
    │   ├── costs/            # construction costs: service.ts (budget, contractors, contracts, progress invoices,
    │   │                     # acceptances, retention), queries.ts (costs by category, margin, cash-flow forecast)
    │   ├── partners/         # agencies and introducers, their commissions (earned at the VSP, paid)
    │   ├── reports/          # getReports: management reports over a period (sales, commercials, ageing, stock)
    │   ├── group/            # getGroupOverview: the companies a gérant runs, each read in its own tenant
    │   ├── privacy/          # Loi 18-07: a person's data export (export kind `person`), prospects' erasure
    │   ├── accounting/       # accounting export: journal entries of every treasury flow, the chart's codes
    │   ├── secrets.ts        # encryptSecret / decryptSecret (AES-256-GCM, SECRETS_KEY): organization secrets
    │   ├── stand-ins.ts      # devGatewaysEnabled, standInUrl (the /api/dev/* stand-ins)
    │   └── <module>/         # schemas.ts (isomorphic) · queries.ts · service.ts · actions.ts · *.test.ts
    ├── jobs/                 # queues.ts (names, retry policy, payload types), enqueue.ts, worker.ts, handlers/
    ├── pdf/                  # render.ts (Chromium), document.tsx (shell + fonts), receipt.ts, quotation.ts,
    │                         # payment-methods.ts (method labels on receipts),
    │                         # templates/ (letterhead, quotation, receipt, reservation-sheet, payment-call,
    │                         # reminder-letter, charge-call, charge-reminder, assembly-convocation,
    │                         # assembly-minutes, announcement-notice, handover-pv, handover-release,
    │                         # certificate, schedule-amendment, cheque-deposit, unit-sheet)
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
- Route Handlers only for: Better Auth (`/api/auth/[...all]`), file upload/download (`/api/files`), spreadsheet exports and imports (`/api/exports/[kind]`, `/api/imports/[kind]`), the payment gateway's return (`/api/online-payments/return`), lead capture (`/api/v1/organizations/[orgId]/leads`, a capture key instead of a session), the WhatsApp webhook (`/api/webhooks/whatsapp/[orgId]`), the local stand-ins of external services (`/api/dev/*`, DEV_GATEWAYS only), future mobile API (`/api/v1/*`). They answer the same `Result<T>` JSON via `jsonResult()` (HTTP status from the error code) and call services exactly like actions.

### Auth & roles
- Better Auth: email + password, password reset, organization plugin, invitations by email (7 days). `session.activeOrganizationId` = current tenant; new sessions land in the user's first organization (database hook); the org switcher changes it.
- Better Auth IDs are random UUID v4 (`generateId: "uuid"`: unguessable invitation links); domain tables use `uuidv7()`.
- Schema-affecting options live in `src/server/auth/schema-options.ts`; `pnpm auth:generate` regenerates `src/db/schema/auth.ts` (timestamps post-processed to `timestamptz`).
- Roles and permissions: `src/lib/permissions.ts` (Better Auth access control). A member may hold several roles (`"accountant,cashier"`). Permissions are `resource:action`; each module adds its resources there.
- `getTenantCtx()` → `{ userId, orgId, roles, locale }`. `assertCan(ctx, 'member:update')` **in services**; the UI uses `can()` only to hide controls.
- Member management (invite, cancel, change roles, remove) goes through `src/server/organizations/service.ts`: our permission check + owner protection, Better Auth performs the change, then `recordAudit` with the acting user. Joining and organization creation are audited by Better Auth hooks. The members page only grants staff roles (`staffRoles`: every role but `owner` and `resident`), in its invitation form, its role menu and `memberRolesSchema` (`validation.staffRole`): the portal role comes only from a portal invitation.
- `proxy.ts` does locale routing only; `(app)/layout.tsx` redirects to `/sign-in` or `/onboarding`.
- Post-login redirects go through `safeNext()` (same-site paths only).
- **Two-factor authentication** (Better Auth `twoFactor` plugin: table `two_factor`, `user.two_factor_enabled`; no `organization_id`, so no RLS): each member turns it on for their own account on `/settings/security` — password, then the authenticator app's QR code (`uqr`, or the key to type) and the backup codes, confirmed by a first code (off until then); off again with the password. With it on, the sign-in form gets `twoFactorRedirect` and sends to `/two-factor?next=…` (the app's 6-digit code or a backup code, used once; « trust this device » 30 days). The dashboard asks the gérant and the comptable to turn it on until they have. Not enforced (a member without a phone keeps signing in).
- **Portal accounts** (module 7): a member whose only role is `resident` (`isPortalOnly`). They see the `(portal)` shell only: `requireTenantCtx()` and the back-office layout redirect them to `/portal`, the portal layout sends staff back to `/dashboard`. Portal pages use `requirePortalCtx()` → `PortalCtx { userId, orgId, name, locale }`; every portal query starts from `portalScope(tx, ctx)` (the account's live `portal_link` rows: buyer files, co-owners / occupants still current) and never takes a record id from the client without checking it belongs to that scope. Staff lists (`listMembers`, `listPendingInvitations`) leave portal accounts and invitations out. Downloads: `/api/files` checks a portal account with `portalCanRead` (`src/server/portal/files.ts`) instead of the staff readers — the files of its own sales (entity `reservation` of a sale its buyer files take part in) and, under entity `residence`, its co-owned units' charge calls, receipts and reminder letters, its co-owned residences' convocations and PVs, and published notices of its residences; the site photos of the published progress reports of the projects it bought in (entity `construction_report`); the delivery PVs of its sales (entity `handover`); the documents of its own buyer files (entity `buyer`). Portal mutations use `definePortalAction` (portal context, never a staff one). **Buyer documents from the portal** (`/portal/documents`, « Mon dossier »): the pieces of each linked buyer file (the required ones and any other received) with their state; the buyer sends a scan (`POST /api/files` purpose `portal.buyer_document`, the portal context and `portalScope` instead of a staff context: `uploadPortalBuyerDocument`), the piece becomes « received » with `submitted_from_portal` (staff see « envoyée depuis l'espace client » and a dashboard to-do for `buyer:update`), never once verified; audited `buyer_document.portal_upload`. Any staff change to the piece clears the mark. **Requests from the portal** (`portal_request`): on a live sale of theirs, a buyer asks for an attestation (réservation, versements, paiement intégral, avancement), an appointment (a wished day) or anything else (a message); at most 5 waiting per sale; audited `portal_request.create`. Staff who see the sale (`sale:read`, sale visibility) find them on `/sales/requests` and the dashboard, do what is asked from the sale page and close the request — done, or declined with an answer (audited `portal_request.close`); the buyer reads the state and the answer on the sale's portal page.
- **Portal invitations** (`portal:invite`: gérant, directeur commercial, gestionnaire; `buyer:update` for a buyer file, `residence:update` for a co-owner / occupant): `inviteToPortal` inserts a Better Auth `invitation` row (role `resident`, 7 days) itself — staff below the gérant have no Better Auth `invitation:create` — and e-mails it bilingually; the existing accept-invitation page accepts it and the `afterAcceptInvitation` hook (`linkPortalAccount`) gives the account every record waiting on its e-mail. An e-mail already used by a portal account of the organization is linked at once; a staff member's e-mail is refused. One live link per record; withdrawing it (`revokePortalLink`) keeps the row (revoked) and cancels an invitation nobody else waits on. Audited `portal.invite` / `portal.revoke`.

| Role | FR | Scope today (extended per module) |
|---|---|---|
| `owner` | Gérant | Everything: organization, members, invitations, audit; approves withdrawals, sets commission rates; created with the organization, cannot be changed or removed |
| `sales_manager` | Directeur commercial | CRM & sales, price lists, lead assignment, discounts (and the commercials' discount requests), targets; reservations, VSP, contracts, transfers, unit swaps, bank loans, milestone validation, withdrawal proposals, reminder letters, certificates; construction follow-up (read), deliveries, leases |
| `sales_agent` | Commercial | Own leads/visits/quotations; discount requests (a discount approved by a manager is then granted on the lead's quotations and reservation); buyer files, options and reservations of own leads; own sales and commissions (read) |
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
- Queues today: `email.send`; `pdf.document` (`{ organizationId, kind, id }`, kinds `quotation`, `reservation_sheet`, `receipt`, `payment_call`, `reminder_letter`, `charge_call`, `charge_receipt`, `charge_reminder`, `assembly_convocation`, `assembly_minutes`, `announcement`, `handover_pv`, `handover_release`, `rent_receipt`, `lease_inspection`, `certificate`, `schedule_amendment`, `cheque_deposit`, `unit_sheet`: one renderer per kind in `src/server/documents/render.ts`, each renders once and links the stored file; a running worker must be restarted to know a new kind); `option.expire` (scheduled at the option's expiry); `payment_call.issue` (after a milestone validation); `reminders.daily` (cron 08:00 Africa/Algiers, declared in `schedules` in `queues.ts` and installed by `db:migrate`) → one `reminders.digest` per organization, which sends the overdue sales digest, the overdue charges digest and the rentals digest (overdue rents, leases ending within 30 days); `online_payment.check` (30 minutes after an online payment starts: settles it with SATIM if the payer never came back; retried every 10 minutes while SATIM has it in progress); `whatsapp.send` (one WhatsApp message, queued in the transaction of the event it reports; retried while Meta is unreachable or throttling, then failed).
- `db:migrate` starts pg-boss once with the scheduler on so its internal cron queue exists before any worker (see §12). Stop dev workers by killing the node process tree (Windows keeps children of a stopped shell).

### Email
- Always queued (`sendEmailLater`, or `enqueueInTx` from a job); the worker sends with nodemailer. Attachments travel as storage keys (`attachments: { fileName, storageKey, contentType }`), read from S3 by the worker when sending.
- **Documents to clients** (company setting `email_documents`, off by default, `/settings/company`): sales receipts (REC), appels de fonds (ADF), charge calls (ADC, to the co-owner addressed) and receipts (RCH, to the main co-owner), quittances and deposit receipts (QIT, to the tenant) are e-mailed with their PDF to the clients whose record has an address (each address once; a sale's buyers) — queued by the renderer in the transaction that links the stored PDF (`src/server/email/client-documents.ts`), so once per document; nothing for a document cancelled before its PDF. Bilingual (French then Arabic), no link. Auth and staff emails are **bilingual** (French then Arabic) because the recipient's language is unknown (auth emails; the daily overdue digest). Templates in `src/server/email/templates.ts`, texts in the catalogs (`emails.*`), values HTML-escaped.

### Files
- S3 API only. Local: SeaweedFS (bucket created by `docker:up`). Production: any S3-compatible provider (location TBD, §12).
- Private bucket. Key: `org/{orgId}/{entityType}/{entityId}/{fileId}.{ext}`; a tenant-scoped `file` row holds metadata (`entity_type` + `entity_id` = owner record).
- **Upload**: `POST /api/files` (multipart `purpose`, `entityId`, `file`) → `Result<{ fileId }>`. Same-origin check, body capped while streaming (`readFormData`), then a switch on `purpose` calls the owning service (e.g. `setUnitFloorPlan`), which asserts the permission, runs `checkUpload` (size + **magic-byte** format check against `uploadPurposes` in `src/lib/files.ts`; the browser's MIME type is ignored) and `storeFile(tx, …)` (row insert, then S3 put, inside the tenant transaction). Client: `UploadButton`.
- **Download**: `GET /api/files/{id}[?download]` → access check by `entity_type` (`readers` in `src/server/files/service.ts`: a unit plan needs `inventory:read`, a quotation PDF needs its lead to be visible, a buyer document its buyer, a sale's files its sale) → 302 to a 5-min presigned URL with the original name (`Content-Disposition` with UTF-8 `filename*`).
- Upload purposes today: `unit.floor_plan`, `buyer.document` (variant = document kind), `reservation.contract`, `reservation.deed`, `organization.logo` (PNG/JPEG only, 2 MB; readable by any member of the organization), `construction_report.photo` (JPEG/PNG/WebP, 10 MB, up to 20 per report; entity `construction_report`, readers `construction:read`), `lease.contract` (signed lease scan), `supplier_contract.scan` and `supplier_invoice.scan` (a supplier contract's and an invoice's scan, paid or not; entities `supplier_contract` / `supplier_invoice`, readers `supplier:read`), `reservation.guarantee` (the FGCMPI guarantee certificate, under the sale), `project_document.scan` (a regulatory document; entity `project_document`, readers `inventory:read`), `portal.buyer_document` (a buyer's own piece sent from the portal, entity `buyer`), `works_contract.scan` and `works_invoice.scan` (a contractor's contract and progress invoices, entity `works_contract`, readers `cost:read`), `residence_check.scan` (the certificate of an inspection or maintenance visit, entity `residence_check`, readers `residence:read`). Every document of a sale (reservation sheet, receipts, payment calls, reminder letters, certificates, signed scans) is filed under entity `reservation`, so its readers follow the sale's visibility. Residence documents (charge calls, receipts and reminders, assembly convocations and minutes, announcement notices) are filed under entity `residence`; readers need `charge:read`, `assembly:read` or `announcement:read`. Delivery PVs (remise des clés, levée des réserves) are filed under entity `handover`: readers with `handover:read`, or who see the sale. Lease documents (quittances, deposit receipts, états des lieux, signed lease scans) are filed under entity `lease`: readers with `lease:read`.
- Replacing/removing a file soft-deletes the old row (`deleted_at`); the object stays in the bucket. New purpose = entry in `uploadPurposes` + service function + `case` in `src/app/api/files/route.ts` (+ a `readers` entry for a new entity type). Generated documents are stored with `storeFile(tx, { orgId, userId: null }, …)` by their job.
- Issued documents are rendered once at issue; the stored PDF is served for reprints.

### PDF
- Documents are React components rendered to static HTML (`src/pdf/templates/*`) inside `PdfDocument` (embedded font, base CSS), then printed by headless Chromium (`renderPdf`, one browser per process, CSS `@page` for size). Render in the worker, not in requests.
- Arabic blocks use `dir="rtl" lang="ar"`; values that may mix scripts are wrapped in `<bdi>`. Chromium must be installed where PDFs render (`playwright install chromium`).
- Every document starts with the shared `Letterhead` (`src/pdf/templates/letterhead.tsx`): logo, legal name, address, identifiers. Renderers load it with `loadCompanyLetterhead(tx, orgId)`, which embeds the logo as a data URI (Chromium renders offline). A logo change only affects documents issued afterwards.

### Exports
- `GET /api/exports/{kind}?filters&locale=fr|ar` → an .xlsx attachment (`buildExport`): the filters of the list it comes from (`exportParams`), the rows read with the member's rights and visibility (a commercial gets their own leads and sales), headers in the member's language, right to left in Arabic. Kinds: `collections` (journal des encaissements over a period — sales REC, charges RCH, rents and deposits QIT, valid and cancelled, with a summary by nature and method; each source needs its reading right), `sales`, `installments` (every installment of the live sales: paid, remaining, state), `units`, `leads`, `buyers`, `charges` (a residence's unit accounts and residents), `leases`, `invoices`, `ledger` (an account's ledger over a period, from its page), `report` (the management reports, one sheet per table), `accounting` (the period's journal entries, § Treasury), `person` (what is held about one buyer or prospect, § Personal data), `assembly_pack` (a residence's accounts of a year for its general assembly).
- Cells are typed: amounts in dinars with two decimals (`excelAmount`: the one place a bigint becomes a number), calendar days as dates, instants at their Algiers time; 50 000 rows at most per sheet (narrow the filters). Every export is audited (`organization.export`: kind, filters, rows — Loi 18-07). Lists carry an « Exporter (Excel) » button with their current filters; `/exports` gathers them (the journal by period, a project's stock, a residence's accounts).

### Imports (reprise de données)
- `/imports` (sections by rights) → per kind an .xlsx template (`/api/imports/{kind}/template?locale=`: data sheets with headers in the member's language — French and Arabic headers are both recognized — an example row, a help sheet), then `POST /api/imports/{kind}` (multipart `file`, `project` / `residence`, `commit` 0/1, 10 MB) → `runImport`: every row is checked first (`prepare*` → `ImportPlan`: counts, blocking issues with sheet / Excel row / column / message key, warnings for rows left aside); with `commit` and nothing blocking, every write runs in **one transaction** (all or nothing) through the same services as by hand (`createUnit`, `updateUnitPrice`, `blockUnit`, `createBuyer`, `saveShares`, `addResident` take an optional outer `tx`), then `organization.import` is audited.
- Kinds: `bank_statement` (a bank or CCP account's statement, `account`; `treasury:update`: date, label, reference, debit / credit or one signed amount; lines before the account's opening, or already imported — same day, amount, label, reference and rank — are left aside), `units` (a project's units; buildings must exist; `unit:create`, prices need `price:update`, blocks `unit:block`), `buyers` (`buyer:create` + `buyer:read_all`), `leads` (`lead:create`; source, project, typologies, budget, financing by their labels; a manager assigns each to a commercial by e-mail, a commercial's leads are theirs; a phone already a live lead's = warning), `sales` (ongoing sales with their schedules and past payments; `sale:create` + `sale:sign` + `payment:create` + `buyer:read_all`: the gérant), `residents` (co-owners, occupants and tantièmes of a residence; `residence:update`). Already there (unit code, buyer NIN or phone + name, a current resident of the unit) = warning, left aside; the same row twice in the file = issue.
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
| Dépenses de communication | `marketing_spend` | one amount per month and lead source |
| Clé de capture de prospects | `lead_capture_key` | site web / automatisation; SHA-256 only; revoked, never deleted |
| Agence immobilière / apporteur d'affaires, commission | `partner` (`partner_kind`: `agency`, `introducer`) / `partner_commission` | a lead names its partner; commission earned at the VSP |
| Prospect | `lead` | one `full_name`, E.164 `phone`/`phone2`, `city` free text; `lead_source`: `facebook`, `instagram`, `whatsapp`, `ouedkniss`, `walk_in`, `referral`, `phone`, `website`, `other`; `lead_stage`; interest (project, typologies, budget, `financing_mode`) |
| Historique du prospect | `lead_activity` | append-only timeline (`lead_activity_type`) |
| Visite | `visit` | |
| Relance | `follow_up` | |
| Devis / Simulation | `quotation` | |
| Commission / Objectif | `commission` (+ `commission_rate`) / `sales_target` | targets per commercial and month: visits done, quotations issued, reservations signed (not withdrawn), VSP signed; commission = % of the net price earned at the VSP, rate per commercial or company default |
| Échéancier type | `payment_plan` / `payment_plan_step` | per project; step `trigger`: `signing`, `months_after_signing`, `milestone` |
| Réglages de la société | `organization_setting` | quotation validity, option hours, payment-call delay, withdrawal retention, late penalties (rate, grace, cap), default commission, VSP limits, delivery indemnity, termination (notice delay, notices required, retention), documents e-mailed to clients |
| Acquéreur | `buyer` | |
| Pièces du dossier (CNI, extrait de naissance, fiche familiale, attestation de travail, fiches de paie) | `buyer_document` | `document_kind` enum |
| NIN (numéro d'identification national) | `national_id_number` | |
| Option | `unit_option` | has `expires_at` |
| Demande de remise | `discount_request` | `pending` → `approved` (for the amount asked or less, `valid_until`) / `rejected` / `cancelled`; `expired` derived |
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
| Avenant (nouvel échéancier) | `schedule_amendment` | numbered per sale (n° 1, 2…), lines replaced and new lines snapshotted, bilingual PDF |
| Désistement / résiliation pour non-paiement | `withdrawal` (`withdrawal_kind`: `withdrawal`, `termination`) | refund / retention |
| Mise en demeure | `reminder_letter` with `kind` `formal_notice` | numbered by rank on its sale when printed; its delay is a company setting |
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
| Révision du loyer / caution | `lease_revision` / `lease.guarantor_*` | from a period's first day on; append-only |
| Loyer payé d'avance (mensuel, trimestriel, semestriel, annuel) | `rent_frequency` | rent periods derived (`buildRentPeriods`), due on their first day |
| Dépôt de garantie | `lease.deposit` (+ `deposit_carried` on a renewal) | collected as a payment, settled at the end (refunded / retained) |
| Quittance de loyer / reçu de dépôt | `rent_payment` (`kind` `rent` / `deposit`) | receipt `QIT-` on the same row |
| État des lieux (entrée / sortie) | `lease_inspection` | `inspection_kind` `check_in` / `check_out`; one of each per lease, final |
| Résidence (après livraison) | `residence` | |
| Syndic / Administration des biens | `property_management` | |
| Copropriétaire / Occupant | `resident` with `resident_kind`: `co_owner` / `occupant` | **`co_owner`, not `owner`** (clash with role, §12) |
| Quote-part / Tantièmes | `share` | integer, per unit per residence |
| Budget prévisionnel | `budget` | |
| Appel de charges | `charge_call` (+ `charge_call_line`) | one per unit and period; a `charge_period` is one issue of a budget period, or an exceptional call (`kind` `works`) |
| Encaissement de charges / Reçu de charges | `charge_payment` | receipt `RCH-` on the same row |
| Clé de répartition | `distribution_key` | `equal`, `share`, `per_building`, `custom` |
| Bâche d'eau, électricité communs, ascenseur… | `charge_category` | |
| Fonds de réserve | `reserve_fund` | |
| Fournisseur / Prestataire, contrat, facture | `supplier` / `supplier_contract` / `supplier_invoice` | |
| Dossier de recouvrement, démarche, échéancier d'apurement | `charge_recovery` / `charge_recovery_step` (`recovery_step_kind`) / `charge_repayment_plan` | one open file per unit; steps append-only; plan cancelled, never edited |
| Contrôle réglementaire, assurance, entretien / visite | `residence_check` (`check_kind`, `check_category`) / `residence_check_visit` (`check_result`) | next deadline, frequency in months; archived, visits append-only |
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
| Bordereau de remise de chèques | `cheque_deposit` (+ `cheque_deposit_item`, `cheque_source`: `sale`, `charges`, `rent`) | numbered `BRC-`; its cheques cleared together |
| Relevé bancaire / rapprochement | `bank_statement` (+ `bank_statement_line`) / `bank_match` | lines signed (credit > 0), matched with ledger entry keys (`sale:<id>`, `movement:<id>`…) |
| Journal d'audit | `audit_log` | |
| Société (SARL) | `organization` | Better Auth table + legal fields below |
| RC, NIF, NIS, AI (identifiants légaux SARL) | `organization.rc_number`, `nif`, `nis`, `ai_number` | + `legal_name`, `address`, `wilaya`, `phone`; printed on documents |
| Membre / Invitation | `member` / `invitation` | Better Auth tables |
| Wilaya / Commune | `wilaya` / `commune` | free text on projects, leads and buyers; the 58 wilayas offered as suggestions (`src/lib/wilayas.ts`, `WilayaOptions`); communes stay free text |

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
| Bordereau de remise de chèques | `cheque_deposit` | `BRC` |
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
| `sold` | `available` | termination for non-payment approved (no handover started) |
| `available` / `blocked` | `delivered` | sold and handed over before the app (`recordPastDeliveries`, delivered project only) |
| `blocked` | `rented` | lease of a unit kept by the company |
| `blocked` / `rented` | `available` | unblock / lease ended |
- Anything else → `INVALID_TRANSITION`. `delivered` is terminal on the sales side.
- **Only** `transitionUnit(tx, actor, unitId, to, { reason, refType, refId })` (`src/server/inventory/transition-unit.ts`; `actor.userId` null for jobs) writes `unit.status`: row lock, validation, `unit_status_history`, audit `unit.status_change`. New units start `available` (history row, no transition).
- Manual block/unblock needs a reason (`blockUnit` / `unblockUnit`, permission `unit:block`). Units, buildings and projects are soft-deleted, and only when nothing is engaged (unit `available`/`blocked`; building/project without live units).
- **Fiche du lot** (`unit_sheet`, `inventory:read`): from the unit page, a bilingual PDF for a prospect — project, building, type and typology, floor, areas, orientations, planned delivery, availability, the day's asking price and price per m², the floor plan when it is an image, and the project's default payment plan applied to that price; a snapshot (`unit_sheet`: status, price, plan lines) rendered by the worker (`pdf.document` kind `unit_sheet`, filed under the unit); the same day's sheet is reused while the price and the status are unchanged.
- Unit codes default to `{building}-{floor}-{nn}` (`A-03-02`; basements `S1`), unique per project; `generateUnits` skips existing codes (max 500 per run).
- Reservation transfer: unit stays `reserved`, buyer changes. Unit swap: A `reserved → available` + B `available → reserved` in one transaction.

### CRM (leads)
- Fixed pipeline `new → contacted → visit_scheduled → visited → negotiation → won | lost`; `lost` needs a `lost_reason`. Manual changes go anywhere; events only move a lead **forward** and never out of won/lost (`advanceStage`): follow-up done → contacted, visit planned → visit_scheduled, visit done → visited, quotation issued → negotiation. Every change writes `lead_activity` in the same transaction.
- Duplicates (same phone in `phone`/`phone2` of another live lead) are allowed and **flagged**, never stored as a flag. Managers merge: visits and follow-ups move to the kept lead, empty fields are filled, the other lead is soft-deleted with `merged_into_id` (its timeline stays visible), audited `lead.merge`.
- A commercial's new lead is assigned to them; managers assign or leave unassigned. Reassignment moves the previous owner's open follow-ups. Overdue follow-ups are derived (`due_at < now()` in SQL).
- **Agencies and introducers** (`partner`, managers `lead:assign` keep them; `/partners`, also open to `commission:read_all`): a real-estate agency or an apporteur d'affaires with a commission rate (% of the net price, 0–20 %); a lead names the partner who brought it (« Apporté par », `lead.partner_id`, on the lead form and sheet). At the VSP (`recordSale`, same transaction) the partner of the sale's lead earns `partner_commission` (base = net price, its current rate, none at 0 %); a withdrawal or a termination cancels it; the accountant (`commission:update`) pays it from an account (« Payé depuis », source `partner_commission` in the ledger). Audited `partner.create / update / commission_pay`.
- **Lead capture** (`lead_capture_key`, managers `lead:assign`, `/settings/lead-capture`): websites (server side) and automations (Zapier, Make: Facebook Lead Ads…) post leads to `POST /api/v1/organizations/{orgId}/leads` with `Authorization: Bearer lck_…` (JSON or form fields; French / English field names: `nom`/`fullName`, `telephone`/`phone`, `email`, `ville`, `source`, `projet` (code), `message`, `campagne`). A key is shown once (only its SHA-256 is kept), names a default source and project, and is revoked, never deleted; each call creates the lead through `createLead` as the member who made the key (unassigned, duplicates flagged), the key's name as source detail; 30 calls per key and minute at most. Audited `organization.capture_key` / `capture_key_revoke`.

### Payment plans & quotations
- A plan's step shares (basis points) sum to exactly 10 000; `buildSchedule(price, steps, signingOn, milestones)` splits with `allocate()` and dates each line (signing day, signing + N months, milestone planned date). Construction milestones are planned per project with a construction `stage` (VSP limit check); module 3 validates them (payment calls), module 4 will add the construction follow-up.
- A quotation is issued for a lead and an `available`/`optioned`, priced unit, with a plan of the unit's project: number `DEV-YYYY-NNNNNN`, snapshots of list price, discount, net price and lines; `valid_until` = issue day + company validity. Only managers discount (≤ list price), or a commercial up to a discount approved for the lead and unit (§ Discount requests). Issued quotations are never edited or deleted, only cancelled with a reason (audited); "expired" is derived from `valid_until`.
- The bilingual PDF is rendered once by the `pdf.document` job (kind `quotation`, enqueued in the issuing transaction) and linked with `pdf_file_id`; the page offers a retry if it is missing.

### Pricing
- `unit.list_price` is the current asking price. It changes only through `updateUnitPrice` (one unit, reason required, audit `unit.price_change`) or by applying a **price list**.
- `price_list`: versioned per project (`V1`, `V2`…), `draft` → `applied` | `discarded`. A draft is prefilled from current prices, edited as a whole (bulk % change, price per m² × living area, rounded half-up), then applied in one transaction: only changed units get a `unit_price_history` row; one audit `price_list.apply` lists the changes. Applied/discarded lists are read-only.
- `unit_status_history` and `unit_price_history` are append-only (no `UPDATE`/`DELETE` grant).
- A reservation **snapshots** the agreed price and discount; later price-list changes never touch it.

### Reservations and VSP
- An option (`unit_option`, company duration) holds an `available` unit for one lead; its expiry job releases the unit. Only buyers of the holder's lead can reserve an optioned unit.
- `createReservation` (`sale:create`): 1–3 visible buyers (main first), an `available` (or optioned-for-them) priced unit, a plan of its project, a date not in the future; only `sale:discount` may discount (≤ list price), or a commercial up to a discount approved for the sale's lead and unit. In one transaction: number `RES-`, snapshot of list price / discount / net price, installments from the plan (`allocate`, sum == price), option converted, unit `reserved`, lead activity + stage `won`, audit, reservation sheet job. The commercial credited is the lead's owner (else the main buyer's follower).
- Milestone installments have no due date until their milestone is validated: then `due_on = max(validation + company delay, reserved_on)` (`milestoneDueOn`); a milestone already reached at signing is due at signing.
- **Discount requests** (`discount_request`): a commercial (`discount:request`) asks for a discount on an `available` / `optioned` priced unit for one of their leads (amount ≤ list price, a reason; one pending per lead and unit); the gérant or the directeur commercial (`discount:decide`, `/sales/discounts`, dashboard to-do) approves it for the amount asked or less — usable `DISCOUNT_APPROVAL_DAYS` (30) days — or rejects it with a note; the requester (or a manager) may withdraw a pending one. `assertDiscountAllowed` (quotations, reservations): managers discount freely, anyone else up to the largest approved and unexpired discount of that lead (the sale's lead: the option holder's, else the main buyer's) and unit. Lead timeline (`discount_requested`, `discount_decided`), audited `discount_request.create / approve / reject / cancel`.
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
- **Warranties** (`warrantyEnds`): parfait achèvement one year, bon fonctionnement two years and décennale ten years from the handover PV, shown on the sale page, the delivery page and the portal.
- **Warranty claims** (`warranty_claim`, `handover:update` to handle, `handover:read` to read): after the PV, a defect is recorded by staff (delivery page) or reported by the buyer from the portal (« Signaler un désordre », dated today), numbered within the handover, refused once every warranty has run out (`runningWarranties`). Staff qualify it under a warranty still running when it was reported and pass it to a contractor (an organization supplier) with a deadline (reassignable), then record it fixed (from the assignment to today) — or reject it with a reason the buyer reads. States `open` → `assigned` → `fixed`, or `rejected`; past its deadline an assigned claim shows late; the dashboard lists the claims to qualify and the late ones. Audited `warranty_claim.report / assign / fix / reject` on the handover; claims are never deleted.

### Treasury (cash desks and accounts)
- **Accounts** (`treasury_account`; `treasury:read`: gérant, comptable, caissier; `treasury:update`: gérant, comptable; `treasury:count`: the three): cash desks (caisses), bank and CCP accounts with an opening balance on their opening day (flows dated before it are in it); one default account per kind among open ones; name, bank, RIB / RIP and notes editable, the opening fixed; closing needs a nil balance (transfer the rest first), then the account takes no money. Audited `treasury_account.create / update / close`.
- **Where collections land** (`resolvePaymentAccount`, called by `insertSalePayment`, `insertChargePayment` and the rent payments): the account chosen in the form (« Encaissé sur », open, of a kind the method fits: cash → a cash desk; cheque, transfer, CCP, bank loan, card → a bank or CCP account), else the default account of the method's kind (a CCP payment falls back on the default bank); none when the organization keeps no accounts. Online payments land on the default bank account. A cancelled payment leaves its account's balance.
- **Movements** (`treasury_movement`, `treasury:update`): an income, an expense (label, category, reference) or a bank fee on one account, or a transfer between two (two rows sharing `transfer_id`, e.g. the cash desk's takings paid into the bank); never in the future nor before the account's opening; immutable, cancelled with a reason (both sides of a transfer). Audited.
- **Balance and ledger** (`accountTotals`, `getAccountLedger`): opening balance + valid collections (sales, charges, rents and deposits) + live movements, by day; today's money in and out; cheques received and not cleared (« dont chèques à encaisser »). `/treasury` lists the accounts with totals per kind; `/treasury/[accountId]` shows the ledger over a period (the current month by default): the balance carried forward, each line with its source, payment method and receipt, the running balance; Excel export (`ledger`).
- **Arrêté de caisse** (`cash_count`, `treasury:count`, cash desks only): the cash counted on a day against the ledger's balance that day; a difference needs an explanation and is booked as an `adjustment` movement (never cancelled: count again), so the ledger follows the cash actually there. Final; audited `cash_count.create`.
- **Deposit slips** (`cheque_deposit`, `treasury:count`: gérant, comptable, caissier): on a bank or CCP account's page, the cheques received on it, valid, not cleared and on no slip yet (sales, charges, rents) are listed; the ticked ones go on a bordereau de remise numbered `BRC-` (deposit day from the latest cheque's receipt to today; each cheque on one slip only, cheques snapshotted), audited `cheque_deposit.create`, bilingual PDF (`cheque_deposit`, filed under the account, readers `treasury:read`). When the bank credits it, « Encaissés » (`payment:create`) clears its cheques still valid on that day (a bounced one is cancelled by the accountant first), audited `cheque_deposit.clear`. Slips are immutable but for their clearance and PDF link.
- **Bank reconciliation** (`/treasury/[accountId]/reconciliation`, bank and CCP accounts; `treasury:read` to read, `treasury:update`: gérant, comptable, to act): statements are imported through the `bank_statement` import (Excel or CSV export of the bank, or the template); each line is matched with ledger entries of the account (`ledgerLines`: every collection, outflow and movement, keyed `sale:<id>`, `charges:<id>`, `movement:<id>`…) whose signed amounts sum to the line's — an entry once (`bank_match`, unique per account). **Suggestions** (`suggestMatches`, `src/lib/reconciliation.ts`): the one entry of the same amount closest in time within 10 days (none on a tie), else for a credit the one deposit slip of that total credited within 20 days of its deposit; accepted one by one or all at once. A line only the bank knows (fees, agios, a direct debit) is **booked** as a movement on its day (income for a credit, expense or bank fee for a debit) and matched in the same transaction; a line with nothing to match (a rejected cheque and its reversal) is **set aside** with a reason. Cancelling a payment or a movement undoes the matches of its line (`unmatchEntry`). A statement nothing was matched or set aside on can be withdrawn. Audited `bank_statement_line.match / unmatch / dismiss / restore`, `bank_statement.delete`; the import itself `organization.import`.
- **Outflows**: contractors' progress invoices and released retentions (§ Construction costs), supplier invoices, residence staff pay and salary advances (with their method, cash by default), withdrawal and termination refunds, and lease deposit refunds are paid from an account (« Payé depuis », chosen or the method's default: `resolvePaymentAccount`) and appear in its ledger (sources `works`, `retention`, `supplier`, `staff_pay`, `advance`, `refund`, `deposit_refund`, `partner_commission`). Anything else leaving an account is an expense movement.
- **Accounting export** (`/treasury/accounting` and `/exports`, `treasury:update`: gérant, comptable; export kind `accounting`): the journal entries of a period for the chartered accountant — every flow of every treasury account (`ledgerLines`) as two balanced lines: the account's own code and journal (`treasury_account.accounting_code` / `journal_code`, else by kind: 530000 / CA, 512000 / BQ, 517000 / CCP) against the counterpart of its nature (`counterpartKey`, `src/lib/accounting.ts`: acquéreurs 411, copropriétaires 467, locataires 411100, dépôts reçus 165, fournisseurs 401, entreprises 401100, personnel 421 / 425, commissions 622, frais 627, autres dépenses 628, autres recettes 758, virements internes 581, écarts de caisse 658 / 758); the chart is the SCF's by default and each organization overrides it (`organization_setting.accounting_codes`, audited `organization.accounting_codes`). A transfer passes through 581 in both journals; cheques count at their receipt. Sales, charge calls and VAT are left to the accountant (no revenue recognition, no G50).

### Construction costs (contractors)
- **Rights**: `cost:read` (gérant, comptable, responsable technique), `cost:update` (gérant, responsable technique: budget, contracts, progress invoices, acceptances), `cost:pay` (gérant, comptable: payments and retentions). The directeur commercial and the commercials do not see costs or margins.
- **Budget** (`project_budget_line`): per project, lines by category (land, studies, works, VRD networks, fees, financial, marketing, other) saved as a whole; audited `project_budget.save`.
- **Contracts** (`works_contract`): with a contractor or design office (a `supplier`; `createContractor` adds one from the costs page), a category, reference, object, amount (TTC), retention of guarantee (default 5 %, 0–10 %), signing day (not in the future) and planned end; corrected while open — never below what is invoiced, the retention rate fixed once a progress invoice exists; deleted (soft) only without progress invoices. **Réception provisoire** then **définitive** (dated from the signing / the provisional on, with notes); **résiliation** with a reason (no more invoices). Audited.
- **Progress invoices** (`works_invoice`, situations): numbered per contract, invoice day not before the signing, gross amount; the retention (`invoiceSplit`: half-up at the contract's rate) and net payable are computed; the contract's total never above its amount; corrected while unpaid; only the last unpaid one is deleted. **Paid** (`cost:pay`, from the invoice day to today) from an account (§ Treasury), then read-only. After the réception définitive the retention held is **released** once, from an account. Audited `works_invoice.*`, `works_contract.release_retention`.
- **Project costs page** (`/projects/[id]/costs`): per category budget, committed (contract amounts; a terminated contract commits what it invoiced), invoiced, paid; unpaid net and retentions held; **margin** (`projectMargin`): expected revenue (live sales signed + available / optioned stock at list price) against the forecast cost (per category the larger of the budget and the committed); **12-month cash-flow forecast**: expected collections (each live sale's remaining installments by due month, overdue ones in the current month; installments waiting for a milestone shown apart) against expected spending (unpaid progress invoices by due day, what remains to invoice on open contracts spread evenly to their planned end, `spreadRemaining`), net and cumulative.

### Reports
- `/reports` (`report:read`: gérant, directeur commercial, comptable), over a period (this year by default) and optionally one project, all sales of the organization: totals (reservations signed and not withdrawn, VSP signed, collected; withdrawn ones counted apart); **by month** (reservations and VSP signed, collected); **by project and typology** (sales, amount, average price per m² of living, else usable, area); **commercials** (leads given in the period, reservations credited, VSP, conversion, amount, collected on their sales); as of today, **receivables by age** (`ageingBucket`: not due, 1–30 … over 180 days late, waiting for a milestone) and **expected collections** for the next 6 months (overdue counted in the current month); **stock** by project and typology (available, optioned, reserved, sold, value at list price); **cost and return per lead source** (leads received, reservations signed by those leads and their amount, against the marketing spend of the period's months — `marketing_spend`, one amount per month and source, entered by the gérant or the directeur commercial (`target:update`), 0 removes it, audited `organization.marketing_spend` — with the cost per lead and per reservation). Excel export (`report`).
- **Vue groupe** (`/group`, `getGroupOverview`): a member who is gérant (`owner`) of two organizations or more sees them side by side — this year's reservations (count, amount), VSP signed, collected, receivables overdue and expected over 6 months, stock for sale (available and optioned units, value), cash on the open accounts — with the group's total; each company is read with a tenant context of its own (its RLS, the member's roles there), the sidebar shows the entry only to such members, « Ouvrir » makes a company the active one (like the org switcher). Companies where the member is not gérant are left out.

### Certificates (attestations)
- Issued on a live sale (`sale:certify`: gérant, directeur commercial, comptable, caissier; the sale must be visible) from the sale page, optionally addressed to a bank or an administration (« À l'attention de … », else « à qui de droit »): **attestation de réservation** (buyers with birth and NIN, the unit, the contract, the price in words; the VSP once signed), **attestation de versements** (needs a valid payment: total paid in words, every valid payment with its receipt — an imported one with the previous system's number — cheques not cleared marked « sous réserve d'encaissement », what remains), **attestation de paiement intégral** (nothing left to pay and no cheque awaiting clearance), **attestation d'avancement des travaux** (the building's progress from its latest live report, the milestones planned and reached), **relevé de compte** (schedule with paid / remaining / state, payments, totals; not an attestation, no signature).
- `issueCertificate`: number `ATT-` in the transaction, everything printed frozen in `certificate.data` (`certificateSnapshot`: amounts as centime strings — later payments never change an issued certificate), bilingual PDF by the worker (`pdf.document` kind `certificate`: letterhead, « Nous soussignés … attestons que », « pour servir et valoir ce que de droit », place and date, signature and stamp box), filed under the sale; audited `certificate.issue` on the sale. Immutable (grants: only the PDF link).
- **Portal**: the buyer sees every certificate of its sale and draws its own relevé de compte (`issuePortalStatement`, progress from published reports only, marked « établi depuis l'espace client »); the one drawn earlier the same day is served again while the paid total is unchanged. Attestations stay issued by staff (signed and stamped).

### After the reservation
- **Withdrawal** (`withdrawal`): reserved sales only; proposed (`sale:withdraw`) with a retention in basis points of the amount paid (company default prefilled) and a reason; one open proposal per sale. The gérant (`sale:approve`) rejects (note required) or approves: amounts recomputed on what is paid at approval, sale `withdrawn` (`ended_on`), unit `available`, earned commission cancelled, lead activity, audit. Payments stay valid; the refund (paid − retention) is recorded when paid out (`payment:create`).
- **Formal notices and termination for non-payment**: a mise en demeure (`issueReminderLetter` with `kind: formal_notice`, `sale:withdraw`: gérant, directeur commercial) is a reminder letter of the overdue lines giving at least the company's notice delay (`formal_notice_days`, 15 by default), audited `reservation.formal_notice`, its bilingual PDF titled « Mise en demeure n° k » (rank among the sale's notices) warning of the termination. Once the company's number of notices (`formal_notices_required`, 2) have their pay-by date past and something is still overdue, the directeur commercial proposes a **termination** (`proposeWithdrawal` with `kind: termination`, reserved or sold sales, no handover started; retention prefilled with `termination_retention_bp`, 10 %); the gérant approves it like a withdrawal (one open proposal per sale; amounts recomputed at approval; sale `withdrawn`, unit `available` — from `sold` too —, commission cancelled, lead activity `terminated`, audited `withdrawal.approve` with the kind); the refund (paid − retention) is recorded when paid out. The rates and delays are the contracts' (Loi 11-04), set by the gérant, nothing hard-coded. The deed's cancellation at the notary stays outside the app.
- **Transfer** (`reservation_transfer`): reserved sales only; buyers replaced (payments stay with the sale), history row, sheet rendered again, audited.
- **Unit swap** (`unit_swap`): reserved sales only, within the project; target `available` (or optioned for the sale's lead); new price = list − discount (managers), must be ≥ paid; old unit `available`, new unit `reserved`; installments keep shares and dates, amounts split again with `allocate`; history row, sheet rendered again, audited.
- **Avenant / rescheduling** (`rescheduleSale`, `sale:update`: gérant, directeur commercial; reserved or sold sales): the installments not fully paid (FIFO statement on the amendment day) are replaced by new lines — each due on a day from the amendment on, or at a milestone of the project not validated yet — whose total equals what the replaced lines amounted to (the price never changes; payments keep counting FIFO, a partly paid line's money goes to the first new lines). Paid lines stay; new lines are numbered after every existing position (payment calls stay keyed by position), their shares split the rest of 10 000 bp by amount. Signed on a day from the reservation to today with a reason; numbered per sale; the replaced and new lines and the paid total are snapshotted (`schedule_amendment`, immutable but for its PDF link); audited `reservation.reschedule`; bilingual PDF (`schedule_amendment`: both schedules, price unchanged, payments kept, signatures) filed under the sale, shown on the sale page and the buyer's portal. The form spreads the rest in N equal monthly installments in one click.
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
- **Leases** (`lease`; `lease:read`: gérant, directeur commercial, comptable, caissier, gestionnaire; `lease:update`: gérant, directeur commercial, gestionnaire) rent the units the promoter keeps: an `available` unit or one kept by the company (`blocked`) becomes `rented` (`transitionUnit`, ref `lease`); one active lease per unit. A lease (numbered `BAL-`, signed on a day not in the future) has a kind (habitation / commercial), a tenant (person or company: name, Arabic name, NIN or RC, phone, e-mail, address, activity), an optional guarantor (caution: name, NIN, phone, address; carried to a renewal), a start, a duration in months (1–120; the term's last day is derived), a monthly rent, an optional monthly charges provision, a payment frequency and a deposit. When the unit belongs to a residence, the tenant becomes its main occupant from the start (`occupant_id`).
- **Rent schedule** (derived, `buildRentPeriods`, `src/lib/rentals.ts`): from the start, one period per frequency (the last one shorter), each due on its first day (paid in advance) for its months of rent and charges; FIFO statement like sales (`rentStatement`: paid, remaining, overdue; no penalties). State (`leaseState`): upcoming, running, ending (last day within 60 days), expired (term over, not ended), ended.
- **Payments** (`rent_payment`, `payment:create`): rent (never above what remains on the schedule; allocation snapshot printed) or the deposit (never above what is missing of it, active leases only); methods cash, cheque, transfer, CCP; receipt `QIT-` in the same transaction (bilingual quittance / deposit receipt via the shared receipt template, filed under the lease); cheques « sous réserve », cleared later; cancelled by accountants with a reason (a settled deposit's payments no longer); audited on the lease.
- **Corrections** (`updateLease`): the tenant's details at any time (the occupant follows); the terms only while no payment exists; a renewal keeps its start.
- **Rent revision** (`reviseRent`, `lease:update`; `lease_revision`, append-only): on an active lease, from the first day of one of its periods (after the first one and after any earlier revision) a new monthly rent and charges provision with a reason (indexation, agreement — the form indexes the current rent by a percentage); every period is due at the amounts in force on its first day (`rentOn`, `buildRentPeriods` with `revisions`), so the statement, the overdue rents and the rent cap of payments follow; issued quittances stay as printed. The lease page shows the rent in force and the revisions, a renewal starts from the rent in force; audited `lease.revise`. Nothing is computed from an index (the rate is the contract's).
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
- **Exceptional calls** (`issueWorksCall`, `charge:create`; `charge_period` of kind `works`, no budget): works voted by the general assembly — or any one-off expense — called once: a title (French, Arabic optional), the charge category whose key splits the amount (tantièmes, equal, building or a list of units; the lines carry that category, so the budget report counts them as called there), the total, issue and due days, and optionally the resolution that voted it (adopted by a closed assembly of the residence). One numbered call `ADC-` per unit exactly like a budget period (no reserve fund part), shown everywhere under its title (`callPeriodLabels`), in the units' accounts, the portal and reminders; cancelled like a period. Audited `charge_period.issue_works`.
- **Payments** (`charge_payment`, `payment:create`): receipt `RCH-` on the same row with a snapshot of the calls it settled; methods cash, cheque, transfer, CCP (no bank loan); cheques « sous réserve », cleared later; cancelled by accountants with a reason (`payment:cancel`), never deleted; audited.
- **Unit account** (`chargeStatement`, derived): valid payments applied FIFO to the live calls (due date, then number), no penalties; what exceeds every call issued so far is an advance for the next ones; reserve collected = each call's reserve part × paid / amount.
- **Suppliers** (`supplier`, per organization; `supplier:update`: gérant, comptable, gestionnaire): contracts per residence (period, optional category, indicative annual amount); invoices (`supplier_invoice`) booked to a charge category of the residence (a contract's category by default) or paid from the reserve fund (works); number unique per supplier; editable and deletable while unpaid, then read-only once paid (date, method, reference); audited. A contract's and an invoice's scan can be attached or replaced at any time (`setContractScan`, `setInvoiceScan`).
- **Staff** (`staff_member`, `staff:update`: gérant, comptable, gestionnaire): agents of a residence (role, net monthly salary, charge category their pay is booked to, hire/departure dates); salary advances deducted from a month's pay; monthly attendance grid (marked days: absence, leave, sick, day off; unmarked = worked; Friday/Saturday shaded); monthly pay entered as net amounts (no IRG/CNAS): base + bonus − deduction − the month's advances = net (never negative), editable/deletable until paid; a month's advances are locked once its pay is recorded; audited.
- **Tickets** (`ticket`, `ticket:create`/`ticket:update`: gérant, gestionnaire): on a unit or the common areas of a residence, category and priority; workflow `open → in_progress → resolved → closed` (`in_progress ↔ open`, `resolved → in_progress` reopens, `cancelled` from open/in progress; closed and cancelled are final, `ticketTransitions` in `src/lib/tickets.ts`); assigned to an employed agent of the residence or a supplier (not both); every change goes to the append-only `ticket_event` history (grants). Residents will open them from the portal (module 7).
- **Budget vs actual** (`getBudgetReport`, `charge:read`): per category and calendar year, budget, called (lines of the year's live calls), spent (invoices dated that year, paid or not, plus the staff pay of the year: base + bonus − deduction) and paid; reserve fund (all years): called, collected (derived), spent on works (reserve invoices), balance.
- **Accounts for the general assembly** (export kind `assembly_pack`, residence and year; `charge:read` + `supplier:read`; button on the residence's « Bilan »): one workbook with what the assembly is asked to approve — budget against actual per category with the totals, the reserve fund (called, collected, spent on works, balance), the year's supplier invoices and every unit's account.
- **General assemblies** (`assembly:read` / `assembly:update`: gérant, gestionnaire): `draft → convened → closed`. A draft (date, time, place, kind) gets its agenda of resolutions, each with its majority; it can be edited or deleted. Convening (needs one resolution) fixes the agenda and renders the bilingual convocation (`assembly_convocation`), audited `assembly.convene`. Then the attendance sheet is saved as a whole: every unit of the residence is present, represented (proxy name required) or absent (left out = absent; the promoter votes for units without a co-owner); votes are saved as a whole, one choice (for / against / abstain) per present or represented unit and resolution (no choice = did not vote); a unit made absent loses its votes. Results by tantièmes (`isAdopted`, `src/lib/assemblies.ts`): `simple` = more for than against among votes cast; `absolute` (> ½), `two_thirds` (≥ ⅔) and `unanimity` count over all the residence's tantièmes, absent units included. No quorum is enforced (the share present or represented is shown and printed). Closing (from the meeting day, with the attendance recorded; chair, optional secretary and end time) freezes the sheet (tantièmes, co-owner names), the total, each resolution's tallies and result, renders the bilingual minutes (`assembly_minutes`: bureau, attendance summary, each vote with opponents and abstainers, attendance sheet annex) and is final; audited `assembly.close`.
- **Announcements** (`announcement:read` / `announcement:update`: gérant, gestionnaire): per residence, bilingual (French required, Arabic optional), a category, an optional last day shown (`expires_on`) and a pin. A draft is edited or deleted; publishing (expiry not past) makes it read-only, shown to residents (portal, module 7) and renders the bilingual notice to post in the building (`pdf.document` kind `announcement`, filed under the residence); withdrawing (`archived`) hides it and keeps it in the history; past its last day it is `expired` (derived). Nothing is e-mailed or texted.
- **Checks and maintenance** (`residence_check`, `/residences/[id]/checks`; `residence:read` to read, `residence:update`: gérant, gestionnaire, to keep them): per residence, its insurance (policy number, renewal), regulatory inspections (lifts, fire safety, electricity, gas…) and preventive maintenance (water tank, pest control…), each with an optional supplier, a frequency in months (or a one-off deadline) and its next due day; state derived (`checkState`: late, due within 30 days, in order). A **visit** (`recordVisit`: not in the future, its outcome — compliant, with remarks, not compliant —, supplier, cost, notes) moves the check to the next deadline (the visit's day plus the frequency, editable, after the visit) and keeps the certificate's scan (`residence_check.scan`); visits are append-only. A check no longer followed is archived with its history. The dashboard lists the checks late or due within 30 days to `residence:update`. Audited `residence_check.create / update / archive / visit` on the residence.
- **Overdue charges** (reminders only, never penalties): `/residences/overdue` lists every unit with calls due before today and not covered, most late first; reminder letters (`charge:remind`: gérant, comptable, caissier, gestionnaire) keep the overdue calls as printed, a pay-by date (default 8 days) and the addressee, bilingual PDF; the daily digest e-mails property managers and cashiers when something is overdue.
- **Recovery of arrears** (`charge_recovery`, `charge:remind`: gérant, comptable, caissier, gestionnaire; on the unit's account): a file opened on a unit with overdue calls (one open per unit), the steps taken — reminder letter, formal notice, bailiff's summons, injonction de payer, judgment, agreement, note — dated (from the opening to today), append-only; an **échéancier d'apurement** (`charge_repayment_plan`): at most the overdue amount over 1–24 equal monthly parts (`planLines`) from a day not in the past, frozen; its progress (`planProgress`) is what the unit paid since the plan against the parts due so far (payments still go FIFO to the oldest calls); one live plan per file, abandoned with a reason. The file closes with a reason (settled, abandoned), ending its plan. The overdue list shows each unit's last step and whether its plan is late. Nothing is charged (no penalties, no bailiff fees). Audited `charge_recovery.open / step / plan / plan_cancel / close` on the residence.

### Personal data (Loi 18-07)
- **Right of access** (`personal_data:export`: gérant, directeur commercial; within their visibility): a buyer file's or a prospect's page offers « Données personnelles (Excel) » — export kind `person` (`personExport`): the identity fields held, and for a buyer its documents' state, sales, payments with their receipts and the WhatsApp messages sent to its number; for a prospect its timeline, visits, follow-ups and quotations. Audited like every export (`organization.export`).
- **Right to erasure** (`personal_data:erase`, `anonymizeLead`): a prospect no buyer file comes from is anonymized at their request or past its keeping period, with a reason — name « Prospect anonymisé », phones, e-mail, city, notes and source detail removed, the notes of its visits and follow-ups and the details of its timeline cleared (`lead_activity.data`, the only column the app may update there); source, stage, dates, project and budget stay for the statistics. A prospect who became a buyer keeps its data with its contracts. Audited `lead.anonymize` (the reason, never the erased values). Corrections go through the ordinary forms.

### Audit & deletion
- Audited: prices, payments, receipts, charge categories, budgets, charge periods, charge payments, supplier invoices, general assemblies (convening, closing with results), handovers (PV signed, reserves closed), leases (signed, corrected, ended, renewed, rent revised, deposit settled, états des lieux) and rent payments, online payments (confirmed, refunded), certificates issued, imports, the regulatory files, treasury accounts, movements, cash counts and cheque deposit slips, project budgets, contracts, progress invoices and their payments, the SATIM account and the WhatsApp number, contracts (reservation, sale, contract details), installments/schedules, unit status, milestone validation, discount requests (asked, approved, rejected, withdrawn), schedule amendments, formal notices, terminations, withdrawals (propose / approve / reject / refund), transfers, unit swaps, commissions (paid, rates), organization creation, invitations, member joins/role changes/removals.
- `audit_log(organization_id, actor_user_id, action, entity_type, entity_id, before jsonb, after jsonb, reason, created_at)` written by `recordAudit(tx, scope, entry)` in the same transaction as the change (bigint → string, Date → ISO). `action` is semantic: `<entity>.<verb>`, e.g. `receipt.cancel`, `member.update_roles`. `actor_user_id` null for jobs.
- DB grants enforce it (`post-migrate.sql`): no `UPDATE`/`DELETE`/`TRUNCATE` on `audit_log`, `reservation_transfer`, `unit_swap`; payments and receipts: no `DELETE`, column-level `UPDATE` (cancellation, cheque clearance, PDF link) only; payment calls, reminder letters, certificates and schedule amendments: only their PDF link; reservations and withdrawals: no `DELETE`; charge periods: only their cancellation; charge calls: only their PDF link; charge call lines: append-only; charge payments: cancellation, cheque clearance and PDF link only; charge reminders: only their PDF link; ticket events: append-only; residence checks: no `DELETE` (archived); recovery files: no `DELETE` (closed), their steps append-only, repayment plans: only their cancellation; their visits: only the certificate's scan; handovers and leases: no `DELETE`; rent payments: cancellation, cheque clearance and PDF link only; rent revisions: append-only; états des lieux: only their PDF link; online payments and WhatsApp messages: no `DELETE`; treasury accounts: no `DELETE`; treasury movements: only their cancellation; cash counts: final; cheque deposit slips: only their clearance and PDF link, their cheques append-only; unit sheets: only their PDF link; bank statements and their lines: no `UPDATE` (a line's dismissal only), deleted only while unused; bank matches: deleted to undo.
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
| Works calls | Vitest | rights, a resolution not adopted refused then accepted once its assembly is closed, no future issue, the amount split by tantièmes (no reserve part), the title printed, in the unit's account, counted as called in its category |
| Checks | Vitest | states and next deadlines; rights, late first, dashboard to-do (keepers only), a visit refused before its deadline or in the future, the deadline moved, supplier and cost kept, the certificate filed (readers), visits never deleted, correction, archive, audit |
| Imports | Vitest | templates (sheets per language, help), leads from a CSV export (BOM, `;`, quoted separators, known phone left aside, a manager's assignment, a commercial's own), units (issues, warnings, all or nothing, prices and blocks, rights), buyers then sales (a refused file writes nothing, RES/VSP numbers, statement, imported payments without receipts, audit), co-owners and shares |
| Obligations | Vitest | validity, delay, indemnity (rate, half-up, cap, off), warranties; regulatory file (rights, validation, scan, audit, dashboard alerts); delivery date snapshot and contract correction (audit), guarantee scan, late deliveries in the list and the dashboard |
| Warranty claims | Vitest | refused before the PV and before its day, staff and portal reports numbered, dashboard to-do, deadline in the past refused, assigned then fixed, rejected with its reason shown on the portal |
| Unit sheets | Vitest + Chromium | the default plan applied to the price, reused the same day, a new one after a price change, bilingual HTML and one stored PDF under the unit |
| Partners | Vitest | managers only, a lead naming its agency, the commission earned at the VSP at its rate, paid once from the bank and found in its ledger |
| Lead capture | Vitest | keys (managers only), JSON and form posts with French / English names through the route, source and project defaults, duplicates flagged, invalid body, unknown and revoked keys refused |
| Portal requests | Vitest | a request checked (certificate kind, message), another account refused, the sale's visibility for staff, dashboard count, declined only with an answer, done once, the answer on the portal |
| Portal documents | Vitest | a buyer's pieces listed, sent (another account and a non-document refused), seen by staff and on the dashboard, verified then locked |
| Recovery | Vitest | plan parts and progress; rights, one open file per unit, steps dated, a plan refused above the overdue or starting in the past, late then on track after a payment, shown on the overdue list, cancelled and closed, audit |
| Assembly pack | Vitest | rights, the workbook's sheets (budget with its categories and total, reserve fund balance, invoices) |
| Personal data | Vitest | a buyer's workbook (sheets, identity, payments; commercials refused, one person required, audited), a prospect anonymized (fields and follow-up notes cleared, statistics kept, once only, commercials refused), refused for a prospect a buyer file comes from |
| Accounting | Vitest | counterparts per source, rights (cashier refused), chart and accounts' codes saved over the defaults, a cash receipt, a bank fee and a transfer through 581 as balanced lines in their journals |
| Reconciliation | Vitest | suggestions (closest entry, a slip for a credit, nothing on a tie or too far); a CSV statement imported (a blocking row, lines before the opening and already imported left aside, rights), suggestions accepted, a fee booked (never as income), a line set aside, a used statement kept, a manual match (total and unknown or matched entries refused), a cancelled payment reopening its line |
| Treasury | Vitest | deposit slips (pending cheques, BRC- number, cash desk refused, one slip per cheque, a bounced cheque cancelled then the slip cleared, PDF once), staff advances and pay leaving the cash desk and the bank (wrong kind refused, ledgers); collections on their accounts (chosen, default per method, CCP fallback, wrong kind refused, none without accounts), balances and cheques pending, cancelled payments, movements and transfers in the ledger (running balance), cancellation of both sides, cash counts with an explained difference, closing only when empty, closed accounts refused, rights, audit, immutability |
| Rent revisions | Vitest | periods at the amounts in force (quarterly, charges), rights, a first period or a day off the schedule refused, revisions in order, the statement and the rent in force after, a payment settling the revised period, the guarantor carried to the renewal, audit |
| Costs | Vitest | retention split, month spread, margin; contracts and progress invoices (rights, above contract, last deleted, retention fixed), payment from the bank in its ledger, acceptances in order, retention released once, audit; budget vs committed, margin with the sales and stock, cash-flow forecast (due, undated, spread) |
| Amendments | Vitest + Chromium | rights, total and dates checked, paid lines kept, new positions and shares, statement after, second avenant with a milestone line, snapshots and audit; bilingual HTML and one stored PDF |
| Termination | Vitest | formal notices (managers only, delay from the settings, audit), termination refused without expired notices or nothing overdue, one open proposal, a sold sale terminated (unit available again), désistement unchanged |
| Two-factor | Vitest (`auth.api`) | refused with a wrong password, off until a first code, then the password alone leads to the code (wrong code refused, the app's code opens the session), a backup code once (`tests/totp.ts` computes codes) |
| Group | Vitest | none for one company or a member who is not gérant elsewhere, two companies each read in its tenant (sales, stock, cash) and their total, a company where they are only a commercial left out |
| Reports | Vitest | ageing buckets, months of a period; a source's leads against its spend (commercials refused); totals, price per m², commercials, ageing, expected collections, stock on a sale half paid; rights; the Excel export's sheets |
| Certificates | Vitest + Chromium | rights, kinds refused (nothing paid, not paid in full, cheque pending), ATT- numbers, frozen snapshot, list visibility, audit, bilingual HTML and one stored PDF, the portal statement (reused the same day, another account refused) |
| Client e-mails | Vitest + Mailpit | bilingual message (subject, due day, RTL part), a receipt rendered with the setting off sends nothing, on: one e-mail per address (case-insensitive, buyers without an address skipped), rendered once, the stored PDF attached through Mailpit |
| Exports | Vitest | workbooks read back with `read-excel-file`: typed cells (dinars, dates, Algiers times), the journal per reader's rights (valid and cancelled, summary), visibility of sales, audit |
| Files | Vitest + SeaweedFS | magic-byte sniffing, file names, `Content-Disposition`, upload size cap and origin check (route helpers), floor plans stored/replaced/removed, presigned download |
| E2E | Playwright, production build, `realestate_e2e` reset + seeded | anonymous redirect, sign-in error, a new gérant signs up, turns on 2FA (QR, backup codes, first code) and signs in again with a code, the app manifest and icons, members, org switch, FR→AR RTL, role-based UI; inventory: project → building → generated units → per-m² price list → block → floor plan, read-only commercial (with a fiche du lot PDF), Arabic unit sheet; CRM: lead (flagged duplicate) → call → visit → quotation → PDF by the worker, commercial scope, merge, discount + cancel, targets; sales golden path: lead → option → buyer file → reservation of the optioned unit → sheet PDF → cashier payment → receipt PDF, commercial scope, overdue list; seeded VSP with payment call, bank loan and commission; dashboard sections and overdue link; residence (gestionnaire): next quarter's charge calls → ADC PDF, the seeded terrace works call and a second one by tantièmes, Y-02-03's recovery file from the overdue list → a 3-month repayment plan and a formal notice, overdue co-owner → charge receipt RCH PDF, lift ticket resolved, general assembly draft → convocation PDF → attendance with a proxy → votes → closing → PV PDF, announcement published → notice PDF, a supplier invoice's scan, the overdue extinguishers' check from the dashboard → visit recorded → certificate kept, the year's accounts for the assembly downloaded and read back, Arabic residence; portal (resident): back office refused, own sale → schedule, receipt and sheet PDFs, a payslip sent from « Mon dossier », an attestation asked for and answered by the cashier, co-owned unit's charges, announcements, a ticket reported and received by the gestionnaire, assemblies → PV PDF, published construction reports with their photos, Arabic portal; construction (responsable technique): no sales access, progress report prefilled with the current progress → site photo, internal report kept in the back office, Arabic follow-up; deliveries: list order, appointment → reserve → PV de remise PDF → lifting → PV de levée PDF, unpaid balance warning, a defect recorded after a delivery and passed to a contractor, Arabic deliveries, dashboard to-dos (next handover, late reserves); rentals (gestionnaire): new lease with its schedule preview → deposit and rent receipts (QIT PDF) → entry inspection PDF → end → deposit settled, the pharmacy's indexed second year, the Hamidi lease's guarantor and a 2 % indexation, overdue rents from the sidebar, Arabic leases; online payment (resident, SATIM stand-in): installment paid by card → result page → REC PDF, declined card with SATIM's message, history; the cashier's list; the gérant's SATIM account (password never shown), Arabic settings; WhatsApp (cashier, Cloud API stand-in): a counter payment → « Paiement reçu » to the consenting buyer, sent by the worker; the gérant's number, webhook and ten templates; Arabic log; exports (cashier): the journal of collections and a filtered sales list, downloaded and read back; imports (gérant): a buyers file checked (issues shown), fixed, imported, found in the list; Arabic page; certificates: the cashier's attestation de versements to a bank → PDF, found on the buyer's portal, the buyer's own relevé → PDF; Arabic sale page; obligations (gérant): dashboard to-dos, an FGCMPI affiliation added to La Corniche's file with its scan, Les Oliviers' insurance to renew, a late Amandiers delivery with its indemnity and missing guarantee, Arabic file; treasury: the cashier's cash desk ledger (seeded expense, transfer, count) and a cash count with an explained difference, « Encaissé sur » in the payment form; the cashier's bordereau of the bank's pending cheques → BRC PDF; the gérant's transfer from the bank to the CCP; the gérant's reconciliation of this week's BNA statement (two suggestions accepted, the agios booked); the gérant's accounting export read back (journals, codes, balanced total); Arabic page; costs: the responsable technique records a progress invoice (retention shown) without paying it, the gérant pays the last structural situation from the bank (found in its ledger); Arabic page; reports (gérant): period filter, typologies, commercials, stock, ageing, the seeded Facebook spend per source, Excel download read back; Arabic page; the gérant's group view of El Bahdja and Les Jardins d'Oran; partners: the directrice commerciale adds an agency and names it on a new lead; lead capture: the directrice commerciale creates a key and a lead posted with it reaches the list; personal data: the directrice commerciale downloads Farida Laïb's data, then anonymizes her; discounts: the commercial grants the discount approved for Samir Haddad on a quotation (capped) and asks for another, the directrice commerciale grants Amina Kaci's for less from the dashboard; avenant: the directrice commerciale spreads what remains of the Benchikh sale over 12 months → avenant PDF; termination: the directrice commerciale sees the notices required, sends a mise en demeure on Houda Meziane's overdue sale → PDF |

- Vitest `globalSetup` migrates the test DB and creates the S3 bucket once; each test creates its own organization(s) (`tests/factories.ts`, `tests/auth-helpers.ts`) → isolation without truncation.
- The e2e global setup starts `src/jobs/worker.ts` after the reset, waits (up to 600 s) for the documents queued by the seed, and stops its process tree at the end (documents render during e2e).
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
- Don't import a module that renders a PDF (`react-dom/server`: `src/pdf/*`, every `*documents.ts`) from a page, layout or client component — the Next build rejects it while `pnpm check` passes. Keep renderers in `*documents.ts`, imported only by `src/server/documents/render.ts` and tests; run `pnpm build` before pushing a UI change.
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
- [x] Treasury: cash desks, bank and CCP accounts, every collection on an account (default per method), movements and transfers, ledgers with running balance and Excel export, cash counts; seed and e2e; every outflow on an account too (contractors, suppliers, staff pay and advances, refunds of withdrawals and deposits); cheque deposit slips (BRC-) cleared together; bank statements imported and reconciled with the ledgers (suggestions, fees booked)
- [x] Reports: sales by month, project and typology, commercials, receivables by age, expected collections, stock, cost and return per lead source (marketing spend per month); Excel export
- [x] Construction costs: budget per project, contractors' contracts, progress invoices with retention, payments from an account, réceptions and retention release, margin, 12-month cash-flow forecast; seed and e2e
- [x] Agencies and introducers: named on leads, commission earned at the VSP, cancelled with the sale, paid from an account; seed and e2e
- [x] Fiche du lot: bilingual PDF of a unit for prospects (areas, plan, price, availability, default payment plan)
- [x] Lead capture: keys for websites and automations (Facebook Lead Ads through Zapier / Make) posting leads to an API endpoint; e2e
- [x] Warranty claims after delivery: staff or the buyer (portal) report a defect, qualified under a running warranty (incl. bon fonctionnement, 2 years), passed to a contractor with a deadline, fixed or rejected; dashboard to-dos; e2e
- [x] Portal: buyers send their file's pieces (« Mon dossier ») and requests (attestation, appointment, other) that staff answer
- [x] Discount requests: commercial → directeur commercial / gérant, approved (possibly for less) for 30 days, then granted on the lead's quotations and reservation; seed and e2e
- [x] Avenants: the unpaid part of a schedule replaced by new dated or milestone lines (same total), numbered per sale, bilingual PDF on the sale page and the portal; e2e
- [x] Formal notices (mises en demeure, bilingual PDF) and termination for non-payment once they went unanswered (company settings: delay, number, retention), decided by the gérant, sold units available again; e2e
- [x] Receipts and calls e-mailed to clients with their PDF (company setting): REC, ADF, ADC, RCH, QIT
- [x] Group view: the companies a gérant runs side by side (sales, collections, receivables, stock, cash); e2e
- [x] Residence checks: insurance, regulatory inspections and maintenance with deadlines, visits and certificates, dashboard to-dos; seed and e2e
- [x] Leases: rent revisions from a period on (indexation by a percentage), guarantors; seed and e2e
- [x] Installable app: web app manifest and icons (back office and portal open in their own window)
- [x] Two-factor authentication: authenticator app and backup codes, code step at sign-in, dashboard nudge for the gérant and the comptable; e2e
- [x] Exceptional calls for works voted by the general assembly (split by a category's key, ADC numbered); seed and e2e
- [x] Accounting export: journal entries of every treasury flow (SCF chart adjustable per organization) for the chartered accountant; e2e
- [x] Loi 18-07: a buyer's or a prospect's data exported on request, prospects anonymized (right to erasure); e2e
- [x] Residence accounts for the general assembly in one workbook (budget and actual, reserve fund, invoices, unit accounts); e2e
- [x] Recovery of charge arrears: files with their steps (formal notice, bailiff, court), repayment plans followed against payments; seed and e2e

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
| 2026-10-06 | **Discount requests (recommended, user delegated)**: a commercial asks the directeur commercial or the gérant for a discount on a unit for one of their leads, with a reason; the manager grants it for the amount asked or less (valid 30 days, not a company setting yet) or refuses it with a note. Once granted, the commercial may put up to that amount on the lead's quotations and reservation of that unit — managers keep discounting freely. No e-mail: the dashboard to-do and `/sales/discounts` carry the requests. |
| 2026-10-06 | **Avenants (recommended, user delegated)**: rescheduling never changes the price nor touches payments: it replaces the installments not fully paid with new lines of the same total (dated from the amendment on, or at a milestone not reached), keeps the paid ones, and is printed as a numbered bilingual avenant to sign (filed under the sale, on the portal). Allowed on reserved and sold sales by the gérant and the directeur commercial; no approval step (the signed avenant is the agreement). |
| 2026-10-06 | **Termination for non-payment (recommended, user delegated; legal figures to confirm with a notary)**: formal notices are reminder letters of a stronger kind issued by the gérant or the directeur commercial, each giving at least N days (company setting, 15 by default); after M notices left unanswered (setting, 2) with something still overdue, a termination is proposed and decided by the gérant through the withdrawal workflow (retention prefilled from a setting, 10 %, editable), on reserved and sold sales alike (a sold unit becomes available again; the deed's cancellation is the notary's business); never once a handover has started. |
| 2026-10-06 | Every outflow the app records is tied to an account like the collections (« Payé depuis », else the method's default): staff pay, salary advances (now with a method, cash by default), withdrawal / termination refunds and deposit refunds join contractors' and suppliers' invoices in the balances and ledgers. |
| 2026-10-06 | **Cheque deposit slips (recommended, user delegated)**: cheques stay on the bank or CCP account they were received on (pending until cleared); the cashier hands them to the bank on a numbered bordereau (`BRC-`, bilingual PDF) and, once the bank credits it, clears them all at once — a bounced cheque is cancelled by the accountant before. No separate "cheques in hand" account. |
| 2026-10-06 | **Portal documents (recommended, user delegated)**: buyers send the pieces of their file from the portal (scans checked like staff uploads); a piece sent is « received » and flagged for staff, who verify it; verified pieces are locked on the portal. Buyers also see the pieces staff scanned for them. |
| 2026-10-06 | **Portal requests (recommended, user delegated)**: buyers ask from the portal for an attestation, an appointment or anything else about one of their sales; attestations stay issued and signed by staff (the request only asks), staff close each request with an answer the buyer reads; no e-mail (dashboard to-do and list). |
| 2026-10-06 | **Warranty claims (recommended, user delegated; durations to confirm with a lawyer)**: three warranties run from the handover PV — parfait achèvement 1 year, bon fonctionnement 2 years, décennale 10 years (constants in `warrantyEnds`); claims hang off the handover (not the residence's tickets) so a delivered buyer reports them even without a residence; contractors are the organization's suppliers; no e-mail (portal, dashboard). |
| 2026-10-06 | **Cost per lead source (recommended, user delegated)**: marketing spend is entered per month and lead source (organization-wide, not per project) by the commercial management; the report divides it by the leads received and the reservations signed by those leads in the period. |
| 2026-10-06 | **Live lead capture (recommended, user delegated)**: one keyed endpoint (`/api/v1/organizations/{orgId}/leads`) rather than a Facebook app of our own — websites post to it server side and Facebook Lead Ads arrive through Zapier / Make, with no Meta app review; keys are per site or automation, shown once and revocable; leads arrive unassigned for the managers to dispatch. |
| 2026-10-06 | **Agencies and introducers (recommended, user delegated)**: partners are kept by the managers with one commission rate each; a lead names its partner, and the partner's commission is earned at the VSP on the net price at the partner's rate then (like the commercials'), cancelled if the sale is undone, paid by the accountant from an account. A sale credited to a partner still credits its commercial. |
| 2026-10-05 | **Certificates (recommended, user delegated)**: five documents on a sale — attestations de réservation, de versements, de paiement intégral (refused while anything remains or a cheque awaits clearance), d'avancement des travaux, and the relevé de compte — numbered `ATT-` (one sequence), bilingual, optionally addressed to a bank, content frozen at issue, issued by the gérant, the directeur commercial, the comptable and the caissier. Buyers download them from the portal and draw their own relevé there (unsigned, reused the same day); attestations stay staff-issued because banks want them signed and stamped. |
| 2026-10-05 | Exports are .xlsx (not CSV: Arabic text and French number formats survive) built server side with `write-excel-file`, imports read with `read-excel-file` (both maintained, only `fflate` beneath; `exceljs` is unmaintained). Amounts become dinars as numbers only in spreadsheet cells; exports follow each list's filters and rights and are audited. |
| 2026-10-06 | **Documents by e-mail (recommended, user delegated)**: one company setting (off by default) sends receipts and calls — sales, charges, rents — to the clients whose record carries an e-mail, the PDF attached, bilingual, at issue (rendered once = sent once). No separate consent: the client gave the address for their contract, and these are that contract's documents (Loi 18-07, execution of the contract). Reminder letters and formal notices are not e-mailed (they are delivered by hand or by registered mail). |
| 2026-10-06 | **Bank reconciliation (recommended, user delegated)**: statements come in as files (each Algerian bank exports Excel or CSV differently: a template with date, label, reference, debit / credit is recognized, no bank connection); a statement line is matched with one or several ledger entries of the same total (a deposit slip's cheques as a group), suggested when one entry of the same amount lies within 10 days; bank-only lines are booked as movements, others set aside with a reason. Matches are derived state, deleted to undo, and a cancelled payment or movement reopens its line. |
| 2026-10-06 | **Group view (recommended, user delegated)**: a gérant of several SARLs sees them side by side on one page, each company read through its own tenant context (no cross-tenant query, RLS unchanged) and only where they are gérant; figures are this year's and today's, nothing consolidated is stored; acting on a company still means making it the active one. |
| 2026-10-06 | **Residence checks (recommended, user delegated; legal frequencies to confirm)**: no periodicity is hard-coded (lift inspections, extinguishers, CAT-NAT and multirisk insurance differ by equipment and contract): each check carries its own frequency and next deadline, set by the gestionnaire; a visit sets the next one. Visits keep their certificate; nothing is e-mailed (dashboard). Costs are noted on the visit, not booked (invoices stay with suppliers). |
| 2026-10-06 | **Rent revisions and guarantors (recommended, user delegated)**: a lease's rent changes from one of its periods on (a revision row; earlier periods and issued quittances unchanged) rather than through a renewal; the percentage is typed (the contract's or an agreement), no index is encoded. A guarantor is optional free information on the lease (no document generated), carried to its renewal. |
| 2026-10-06 | **Installable app (recommended, user delegated)**: a web app manifest (standalone, `/` start) and icons drawn by a script rather than a native app or a service worker: installing needs no offline mode, and pages always show live tenant data. Push notifications stay to do (they need a service worker and VAPID keys). |
| 2026-10-07 | **Two-factor authentication (recommended, user delegated)**: Better Auth's two-factor plugin with an authenticator app (TOTP) and backup codes, opt-in per member rather than enforced (field staff may have no smartphone), the gérant and the comptable nudged from the dashboard; no SMS codes (no SMS provider yet). New runtime dependency `uqr` (MIT, no dependencies) draws the setup QR code as SVG in the browser. |
| 2026-10-07 | **Exceptional works calls (recommended, user delegated)**: works voted by the assembly are called as a charge period of their own (kind `works`) rather than through the budget or the reserve fund — the gestionnaire picks the category whose key splits them (a « Travaux » category by tantièmes, or the lift's units only) and may cite the adopted resolution; several calls (installments) may follow one resolution. Nothing is computed from the vote (amount typed, no quorum). |
| 2026-10-07 | **Accounting export (recommended, user delegated; chart to validate with the accountant)**: the app exports what it knows for certain — the money in and out of every cash desk and account — as SCF journal entries (one journal per account, counterparts by flow nature, codes overridable per organization), not the revenue entries of sales or charge calls (VSP revenue recognition and syndic accounting are the accountant's choices) nor G50 figures (tax rules not encoded). |
| 2026-10-07 | **Individuals' rights (recommended, user delegated; to review with the ANPDP declaration)**: access requests are answered with an Excel workbook of what the organization holds about the person (managers only, audited); erasure applies to prospects who never bought — anonymized in place so the statistics stay — while buyers' data is kept with their contracts (legal retention). No automatic retention purge yet (the periods are the organization's to decide). |
| 2026-10-07 | **Recovery of arrears (recommended, user delegated; procedure to confirm with a lawyer)**: the app keeps the file of the recovery (dated steps, notes) and an agreed repayment plan whose progress is derived from the ordinary payments — it neither charges fees or penalties nor prepares court documents; the plan is a commitment tracked on the overdue list, not a change of the calls. |

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
  - [x] Accounting export for the chartered accountant: SCF entries of every collection, outflow and movement by treasury journal, chart adjustable
  - [ ] Entries of the sales and charge calls themselves (revenue recognition) and G50 tax return figures
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
- [x] **6. Cash desk and banks**
  - [x] Cash desks, bank and CCP accounts per company; every collection on an account; movements and transfers; ledgers
  - [x] Cash journal with daily closing (arrêté de caisse)
  - [x] Cheque deposit slips (bordereaux de remise de chèques)
  - [x] Bank statement import and reconciliation
  - [x] Supplier invoices and contractors paid from an account
  - [x] Staff pay, withdrawal and deposit refunds paid from an account

### Priority 2 — important for daily operations
- [ ] **7. Changes to a sale**
  - [x] Rescheduling the installment plan by amendment
  - [ ] Several units in one contract (flat + parking + cellar)
  - [x] Termination by the promoter for non-payment (formal notices, then termination with retention)
  - [x] Discount requests from a commercial to a manager
- [ ] **8. Financing sources**
  - [ ] LPA with CNL aid and eligibility checks (income ceilings, no prior property), subsidised-rate loans
  - [ ] FNPOS or employer aid, Islamic financing (Mourabaha)
  - [ ] Financing plan per sale (own funds, bank, aid) with expected vs received
- [x] **9. Post-delivery warranties**
  - [x] Warranty end dates (parfait achèvement, décennale) on the sale and the portal
  - [x] Warranty claims from buyers through the portal, passed to the contractor, with deadlines (incl. bon fonctionnement)
- [ ] **10. Syndic depth**
  - [x] Exceptional calls for works voted in general assembly
  - [ ] Individual water meters and consumption-based charges
  - [x] Repayment plans for arrears and a recovery procedure (formal notice, bailiff, injonction de payer)
  - [x] Building insurance, regulatory inspections (lifts, extinguishers, civil protection), preventive maintenance calendar
  - [x] Accounts approval pack for the general assembly (Excel: budget and actual, reserve fund, invoices, unit accounts)
  - [ ] Access for the residents' council (conseil syndical)
  - [ ] Residences not built by the company (third-party buildings)
- [ ] **11. Rentals depth**
  - [x] Annual rent revision
  - [ ] Yearly settlement of tenants' charges
  - [x] Guarantors
  - [ ] Lease registration, rental taxes
  - [ ] Management mandates for other owners (owner statements, fees, payouts)
  - [ ] Tenant portal with online rent payment
- [ ] **12. Client communication**
  - [ ] SMS through Mobilis, Djezzy or Ooredoo
  - [x] E-mailing receipts and payment calls to clients
  - [x] Buyers uploading their documents from the portal
  - [x] Requests from the portal (appointment, certificate)
- [x] **13. Lead capture and partners**
  - [x] Excel / CSV import of leads (Facebook Lead Ads exports, website form exports)
  - [x] Live capture: website / project page forms, Facebook Lead Ads webhook
  - [x] Shareable unit sheet as a PDF (plan, price, availability)
  - [x] Outside agencies and business introducers with their commissions
  - [x] Cost and return per lead source
- [x] **14. Reporting**
  - [x] Sales by period, project and typology
  - [x] Receivables by age and collections forecast by month
  - [x] Stock value, commercial performance
  - [x] Consolidated view across the gérant's companies

### Priority 3 — platform and nice-to-have
- [ ] **15. Security and Loi 18-07**
  - [x] Two-factor authentication (every member; the gérant and the comptable are asked to turn it on)
  - [x] Individuals' requests: export of a buyer's or a prospect's data, erasure of prospects (corrections through the forms)
  - [ ] Retention periods (automatic) and the register of processing
  - [ ] Consent beyond WhatsApp, logging who reads personal data
- [ ] **16. Configuration**
  - [x] Reference list of the 58 wilayas (FR / AR), suggested in the address fields (still free text)
  - [ ] Communes, custom roles per company, editable wording on documents
- [ ] **17. Mobile**
  - [x] Installable app (web app manifest, icons, standalone window, iOS home screen)
  - [ ] Push notifications for field staff and residents
- [ ] **18. Extras**: estimated notary fees and registration duties on quotations; payments from the diaspora (currency, exchange rate); electronic signature (loi 15-04); virtual tours, booking of common rooms, visitor management.
