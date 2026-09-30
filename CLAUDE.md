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
    │   │   ├── (app)/        # back-office shell (guard + sidebar) · dashboard · settings/members
    │   │   └── (portal)/     # buyer/resident portal (Phase 2)
    │   ├── api/auth/[...all] # Better Auth handler (Route Handlers: auth, files, webhooks, /api/v1)
    │   ├── api/files/        # upload (POST) · [fileId] download (GET → presigned redirect)
    │   └── fonts.ts          # next/font/local for the shared font
    ├── components/
    │   ├── ui/               # shadcn/ui primitives (generated; sidebar labels made translatable)
    │   ├── app-shell/        # sidebar, org switcher, user menu
    │   ├── forms/            # TextField, FormAlert, useAction, useTranslateKey
    │   ├── files/            # UploadButton (posts to /api/files)
    │   ├── data-table/       # DataTable (TanStack columns), Pagination (links), useSearchParamsState
    │   ├── crm/              # stage/visit badges, phone text + call/WhatsApp, follow-up/visit dialogs
    │   ├── inventory/        # unit/project status badges, stats bar, floor labels
    │   └── auth/ · i18n/     # sign-out, locale switcher
    ├── db/
    │   ├── schema/           # auth.ts (GENERATED) · platform.ts · _columns.ts helpers · index.ts
    │   ├── migrations/       # drizzle-kit SQL (never hand-edit applied files)
    │   ├── sql/post-migrate.sql # RLS on every organization_id table, grants, revokes
    │   ├── seed/             # demo.ts (users, SARLs), inventory.ts (118 units), crm.ts (25 leads,
    │   │                     # visits, follow-ups, targets), sales.ts (plans, quotations); grows per module
    │   ├── client.ts         # pg Pool + drizzle (app role)
    │   ├── tenant.ts         # withTenant(scope, fn, tx?)
    │   └── migrate.ts        # migrateDatabase(): migrations + post-migrate + pg-boss
    ├── server/
    │   ├── action.ts         # defineAction()
    │   ├── auth/             # auth.ts (Better Auth), session.ts (getSession, getTenantCtx, assertCan),
    │   │                     # page-guard.ts (requireTenantCtx, requirePermission), schemas.ts, schema-options.ts
    │   ├── audit/            # recordAudit()
    │   ├── numbering/        # nextDocumentNumber()
    │   ├── email/            # transport, send-later (queue), bilingual templates
    │   ├── files/            # s3.ts (client, ensureBucket), storage.ts (keys, put, presign),
    │   │                     # service.ts (checkUpload, storeFile, discardFile, getFileDownloadUrl)
    │   ├── route-handler.ts  # jsonResult, assertSameOrigin, readFormData (size-capped)
    │   ├── organizations/    # members & invitations; settings.ts (legal identity, sales settings)
    │   ├── inventory/        # projects, buildings, units, price lists, floor plans, transitionUnit
    │   ├── crm/              # leads, visits, follow-ups, merge, targets; access.ts (lead visibility)
    │   ├── payment-plans/    # construction milestones (planned) and payment plan templates
    │   ├── quotations/       # issue/cancel, queries, pdf.ts (job: render + store once)
    │   └── <module>/         # schemas.ts (isomorphic) · queries.ts · service.ts · actions.ts · *.test.ts
    ├── jobs/                 # queues.ts (names, retry policy, payload types), enqueue.ts, worker.ts, handlers/
    ├── pdf/                  # render.ts (Chromium), document.tsx (shell + fonts), templates/, receipt.ts, quotation.ts
    ├── i18n/                 # locales, routing, navigation, request config, typed messages
    ├── hooks/                # client hooks (use-mobile)
    └── lib/                  # isomorphic: result, permissions, money/, dates, document-types, safe-next, auth-client,
                              # inventory, crm (stages), phone, payment-plans (buildSchedule), quotations, files, zod, ids
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
- Detail queries return `null`/not-found for a non-UUID route id (`isUuid`) instead of reaching Postgres.

### Mutations
- Server Actions in `src/server/<module>/actions.ts` (`'use server'`), each `defineAction({ input, permission }, handler)`: zod parse → `getTenantCtx()` → `assertCan` → handler → `Result<T>`. Never throws to the client except Next control flow. Handlers call services, then `revalidatePath`.
- Client components run actions with `useAction(action)` (translated error toasts).
- Route Handlers only for: Better Auth (`/api/auth/[...all]`), file upload/download (`/api/files`), webhooks (SATIM, WhatsApp), future mobile API (`/api/v1/*`). They answer the same `Result<T>` JSON via `jsonResult()` (HTTP status from the error code) and call services exactly like actions.

### Auth & roles
- Better Auth: email + password, password reset, organization plugin, invitations by email (7 days). `session.activeOrganizationId` = current tenant; new sessions land in the user's first organization (database hook); the org switcher changes it.
- Better Auth IDs are random UUID v4 (`generateId: "uuid"`: unguessable invitation links); domain tables use `uuidv7()`.
- Schema-affecting options live in `src/server/auth/schema-options.ts`; `pnpm auth:generate` regenerates `src/db/schema/auth.ts` (timestamps post-processed to `timestamptz`).
- Roles and permissions: `src/lib/permissions.ts` (Better Auth access control). A member may hold several roles (`"accountant,cashier"`). Permissions are `resource:action`; each module adds its resources there.
- `getTenantCtx()` → `{ userId, orgId, roles, locale }`. `assertCan(ctx, 'member:update')` **in services**; the UI uses `can()` only to hide controls.
- Member management (invite, cancel, change roles, remove) goes through `src/server/organizations/service.ts`: our permission check + owner protection, Better Auth performs the change, then `recordAudit` with the acting user. Joining and organization creation are audited by Better Auth hooks.
- `proxy.ts` does locale routing only; `(app)/layout.tsx` redirects to `/sign-in` or `/onboarding`.
- Post-login redirects go through `safeNext()` (same-site paths only).

| Role | FR | Scope today (extended per module) |
|---|---|---|
| `owner` | Gérant | Everything: organization, members, invitations, audit; created with the organization, cannot be changed or removed |
| `sales_manager` | Directeur commercial | Phase 1: CRM & sales, price lists, lead assignment, discounts, targets |
| `sales_agent` | Commercial | Phase 1: own leads/visits/quotations; options & reservations |
| `accountant` | Comptable | Audit read; Phase 1: finance, cancel payments/receipts, exports |
| `cashier` | Caissier | Phase 1: record payments, issue receipts |
| `property_manager` | Gestionnaire de résidence | Phase 2: residence module |
| `resident` | Acquéreur / résident | Portal only (Phase 2), own records only |

### Jobs (pg-boss)
- Schema `pgboss` is owned by the app role; `db:migrate` creates it and creates/updates every queue declared in `src/jobs/queues.ts` (name, retry policy, payload type).
- Worker = separate process (`pnpm worker`), graceful shutdown. Next.js only calls `enqueue()` (send-only instance).
- Tenant jobs carry `organizationId` and run inside `withTenant`; platform jobs (auth emails) do not. Handlers are idempotent. Money in payloads = decimal string of centimes.
- A job that follows a business write is enqueued **in the same transaction** with `enqueueInTx(tx, …)` (pg-boss `fromDrizzle`): it exists only if the write commits. `singletonKey` = the record id.
- Queues today: `email.send`, `pdf.quotation`. Planned: option expiry, overdue reminders (daily 08:00 Algiers), milestone → payment calls, charge calls, receipts, lease alerts.
- `db:migrate` starts pg-boss once with the scheduler on so its internal cron queue exists before any worker (see §12). Stop dev workers by killing the node process tree (Windows keeps children of a stopped shell).

### Email
- Always queued (`sendEmailLater`); the worker sends with nodemailer. Auth emails are **bilingual** (French then Arabic) because the recipient's language is unknown. Templates in `src/server/email/templates.ts`, texts in the catalogs (`emails.*`), values HTML-escaped.

### Files
- S3 API only. Local: SeaweedFS (bucket created by `docker:up`). Production: any S3-compatible provider (location TBD, §12).
- Private bucket. Key: `org/{orgId}/{entityType}/{entityId}/{fileId}.{ext}`; a tenant-scoped `file` row holds metadata (`entity_type` + `entity_id` = owner record).
- **Upload**: `POST /api/files` (multipart `purpose`, `entityId`, `file`) → `Result<{ fileId }>`. Same-origin check, body capped while streaming (`readFormData`), then a switch on `purpose` calls the owning service (e.g. `setUnitFloorPlan`), which asserts the permission, runs `checkUpload` (size + **magic-byte** format check against `uploadPurposes` in `src/lib/files.ts`; the browser's MIME type is ignored) and `storeFile(tx, …)` (row insert, then S3 put, inside the tenant transaction). Client: `UploadButton`.
- **Download**: `GET /api/files/{id}[?download]` → access check by `entity_type` (`readers` in `src/server/files/service.ts`: a unit plan needs `inventory:read`, a quotation PDF needs its lead to be visible) → 302 to a 5-min presigned URL with the original name (`Content-Disposition` with UTF-8 `filename*`).
- Replacing/removing a file soft-deletes the old row (`deleted_at`); the object stays in the bucket. New purpose = entry in `uploadPurposes` + service function + `case` in `src/app/api/files/route.ts` (+ a `readers` entry for a new entity type). Generated documents are stored with `storeFile(tx, { orgId, userId: null }, …)` by their job.
- Issued documents are rendered once at issue; the stored PDF is served for reprints.

### PDF
- Documents are React components rendered to static HTML (`src/pdf/templates/*`) inside `PdfDocument` (embedded font, base CSS), then printed by headless Chromium (`renderPdf`, one browser per process, CSS `@page` for size). Render in the worker, not in requests.
- Arabic blocks use `dir="rtl" lang="ar"`; values that may mix scripts are wrapped in `<bdi>`. Chromium must be installed where PDFs render (`playwright install chromium`).

### Caching
- Tenant data is dynamic by default. Any `use cache` / cached function on tenant data must include `orgId` in its key and be tagged `org:{orgId}:{entity}`.

### Config
- `src/env.ts` validates: `DATABASE_URL` (app role), `DATABASE_OWNER_URL`, `BETTER_AUTH_SECRET` (≥32), `BETTER_AUTH_URL`, `S3_*`, `SMTP_*`. `.env.example` lists them with local defaults.

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
| Commission / Objectif | `commission` / `sales_target` | targets = monthly visits done + quotations issued per commercial (module 2); commissions in module 3 |
| Échéancier type | `payment_plan` / `payment_plan_step` | per project; step `trigger`: `signing`, `months_after_signing`, `milestone` |
| Réglages de la société | `organization_setting` | quotation validity (days) |
| Acquéreur | `buyer` | |
| Pièces du dossier (CNI, extrait de naissance, fiche familiale, attestation de travail, fiches de paie) | `buyer_document` | `document_kind` enum |
| NIN (numéro d'identification national) | `national_id_number` | |
| Option | `unit_option` | has `expires_at` |
| Contrat de réservation | `reservation` | |
| Vente sur plan (VSP, acte notarié) | `sale_contract` | |
| Notaire | `notary` | |
| Échéancier / Échéance | `payment_schedule` / `installment` | |
| Appel de fonds | `payment_call` | |
| Encaissement / Reçu | `payment` / `receipt` | |
| Mode de paiement (espèces, chèque, virement, CCP, crédit) | `payment_method` | `cash`, `cheque`, `bank_transfer`, `ccp`, `bank_loan` |
| Pénalité de retard | `late_penalty` | |
| Désistement | `withdrawal` | refund / retention |
| Cession de réservation | `reservation_transfer` | |
| Changement de lot | `unit_swap` | |
| Crédit bancaire (dossier, accord, déblocage) | `bank_loan` / `loan_disbursement` | |
| Avancement des travaux | `construction_milestone` | |
| Remise des clés (PV) | `handover` | |
| Réserves à la livraison | `punch_item` | |
| Réclamation SAV / résidence | `ticket` | |
| Bail | `lease` | `residential` / `commercial` |
| Dépôt de garantie / Loyer d'avance | `security_deposit` / `advance_rent` | |
| État des lieux (entrée / sortie) | `inspection` | `check_in` / `check_out` |
| Résidence (après livraison) | `residence` | |
| Syndic / Administration des biens | `property_management` | |
| Copropriétaire / Occupant | `resident` with `resident_kind`: `co_owner` / `occupant` | **`co_owner`, not `owner`** (clash with role, §12) |
| Quote-part / Tantièmes | `share` | integer, per unit per residence |
| Budget prévisionnel | `budget` | |
| Appel de charges | `charge_call` | |
| Clé de répartition | `distribution_key` | `equal`, `share`, `per_building`, `custom` |
| Bâche d'eau, électricité communs, ascenseur… | `charge_category` | |
| Fonds de réserve | `reserve_fund` | |
| Fournisseur / Prestataire, contrat, facture | `supplier` / `supplier_contract` / `supplier_invoice` | |
| Agent de sécurité, femme de ménage… | `staff_member` | `staff_role` enum |
| Pointage / Paie / Avance sur salaire | `attendance` / `payroll` / `salary_advance` | |
| Annonce | `announcement` | |
| Assemblée générale, PV, résolution, vote | `general_assembly` / `assembly_minutes` / `resolution` / `vote` | |
| Caisse / Compte bancaire | `cash_register` / `bank_account` | |
| Journal d'audit | `audit_log` | |
| Société (SARL) | `organization` | Better Auth table + legal fields below |
| RC, NIF, NIS, AI (identifiants légaux SARL) | `organization.rc_number`, `nif`, `nis`, `ai_number` | + `legal_name`, `address`, `wilaya`, `phone`; printed on documents |
| Membre / Invitation | `member` / `invitation` | Better Auth tables |
| Wilaya / Commune | `wilaya` / `commune` | global reference tables — deferred to the buyer file (module 3); free text until then |

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
| Devis | `quotation` | `DEV` |
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
- A plan's step shares (basis points) sum to exactly 10 000; `buildSchedule(price, steps, signingOn, milestones)` splits with `allocate()` and dates each line (signing day, signing + N months, milestone planned date). Construction milestones are planned per project here; module 4 validates them.
- A quotation is issued for a lead and an `available`/`optioned`, priced unit, with a plan of the unit's project: number `DEV-YYYY-NNNNNN`, snapshots of list price, discount, net price and lines; `valid_until` = issue day + company validity. Only managers discount (≤ list price). Issued quotations are never edited or deleted, only cancelled with a reason (audited); "expired" is derived from `valid_until`.
- The bilingual PDF is rendered once by the `pdf.quotation` job (enqueued in the issuing transaction) and linked with `pdf_file_id`; the page offers a retry if it is missing.

### Pricing
- `unit.list_price` is the current asking price. It changes only through `updateUnitPrice` (one unit, reason required, audit `unit.price_change`) or by applying a **price list**.
- `price_list`: versioned per project (`V1`, `V2`…), `draft` → `applied` | `discarded`. A draft is prefilled from current prices, edited as a whole (bulk % change, price per m² × living area, rounded half-up), then applied in one transaction: only changed units get a `unit_price_history` row; one audit `price_list.apply` lists the changes. Applied/discarded lists are read-only.
- `unit_status_history` and `unit_price_history` are append-only (no `UPDATE`/`DELETE` grant).
- A reservation **snapshots** the agreed price and discount; later price-list changes never touch it.

### Payment schedule, calls, payments
- Sum of `installment.amount` == contract price exactly (built with `allocate`).
- Installment trigger: `date` (fixed `due_date`) or `milestone` (`construction_milestone_id`; `due_date` = validation date + org-configured delay).
- Validating a milestone enqueues one job that issues one numbered `payment_call` per concerned buyer, idempotently.
- "Overdue" is **derived** (`due_date < today_algiers AND balance > 0`), never stored.
- Each payment issues exactly one receipt. Allocation across installments: rule pending (§12).
- Payments and receipts are **immutable**: no update, no delete. Cancel = `status = cancelled` + `cancelled_at`, `cancelled_by`, mandatory `cancellation_reason`; allocations reversed; audited.

### Residence charges
- `share` = integer weight per unit per residence (tantièmes, e.g. on a 10 000 basis).
- Distribution keys: `equal`, `share`, `per_building`, `custom` (explicit unit list, weighted `equal` or `share`, e.g. RDC excluded from elevator). Every distribution uses `allocate()` → lines sum exactly to the charge.

### Audit & deletion
- Audited: prices, payments, receipts, contracts (reservation, sale), installments/schedules, unit status, organization creation, invitations, member joins/role changes/removals.
- `audit_log(organization_id, actor_user_id, action, entity_type, entity_id, before jsonb, after jsonb, reason, created_at)` written by `recordAudit(tx, scope, entry)` in the same transaction as the change (bigint → string, Date → ISO). `action` is semantic: `<entity>.<verb>`, e.g. `receipt.cancel`, `member.update_roles`. `actor_user_id` null for jobs.
- DB grants enforce it: app role has no `UPDATE`/`DELETE`/`TRUNCATE` on `audit_log` (payments/receipts: no `DELETE`, added with their tables in `post-migrate.sql`).
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
| Files | Vitest + SeaweedFS | magic-byte sniffing, file names, `Content-Disposition`, upload size cap and origin check (route helpers), floor plans stored/replaced/removed, presigned download |
| E2E | Playwright, production build, `realestate_e2e` reset + seeded | anonymous redirect, sign-in error, members, org switch, FR→AR RTL, role-based UI; inventory: project → building → generated units → per-m² price list → block → floor plan, read-only commercial, Arabic unit sheet; CRM: lead (flagged duplicate) → call → visit → quotation → PDF by the worker, commercial scope, merge, discount + cancel, targets; Phase 1 golden path lead → option → reservation → schedule → payment → receipt PDF |

- Vitest `globalSetup` migrates the test DB and creates the S3 bucket once; each test creates its own organization(s) (`tests/factories.ts`, `tests/auth-helpers.ts`) → isolation without truncation.
- The e2e global setup starts `src/jobs/worker.ts` after the reset and stops its process tree at the end (documents render during e2e).
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
- Enqueue follow-up jobs with `enqueueInTx` inside the business transaction; go through `loadVisibleLead` for anything hanging off a lead.
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
- Don't use physical-direction Tailwind classes (`ml-`, `pr-`, `left-`, `text-right`…).
- Don't send email or render PDFs inside a request — enqueue a job.
- Don't edit generated files (`src/db/schema/auth.ts`, applied migrations); regenerate instead.
- Don't commit secrets; `.env*` is git-ignored except `.env.example`.

## 11. Roadmap

**Current: Phase 1 modules 1 and 2 done — `phase-1/inventory` (PR https://github.com/yurigami1939-oss/realestate/pull/2, stacked on #1) and `phase-1/crm` (stacked on #2). Next: module 3 (reservation & sale) — the open business questions below must be answered first.**

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
  - [ ] Commissions and reservation/sales targets → module 3 (§12)
- [ ] Module 3 — Reservation & sale (buyer file, reservation, VSP, schedule, payments, receipts, reminders, penalties, withdrawal, transfer, swap, bank loans)
- [ ] Owner dashboard
- [ ] Audit log viewer
- [ ] Organization settings page — legal identity + quotation validity done (`/settings/company`); logo upload pending
- [ ] Seed: ~~2 projects, 3 buildings, ~120 units~~ · ~~leads, visits, follow-ups, plans, quotations, targets~~ · buyers · payments

### Phase 2
- [ ] Module 6 — Residence management
- [ ] Module 7 — Buyer/resident portal

### Phase 3
- [ ] Module 4 — Construction & delivery
- [ ] Module 5 — Rentals
- [ ] Online payment (CIB/Edahabia via SATIM)
- [ ] WhatsApp Business API notifications

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

### Open items
- **GitHub**: repo `yurigami1939-oss/realestate` is **public** — make it private before real client data or configuration lands. Work happens on branches merged through PRs; CI must be green.

### Open business questions (ask before implementing)
- Late penalty formula (rate, base, grace period, cap) — and check décret 13-431.
- Withdrawal: refund vs retention (% or fixed), deadlines, who approves.
- Allocation of a payment across installments (oldest due first?) and handling of overpayment.
- Cheques: receipt issued on reception ("sous réserve d'encaissement") or on clearance; bounced cheque flow.
- Default option duration; max simultaneous options per agent/lead.
- Receipt/contract language: bilingual FR/AR on one document (current receipt template), or per-buyer choice.
- VSP payment tranches: enforce legal percentages per milestone or free schedule?
- Commission rules (base, rate, trigger: reservation, VSP, or full payment) — to decide when building module 3.
- Hosting location (Loi 18-07 restricts cross-border transfer of personal data).
- Are list prices **TTC** (TVA included) or HT? Quotations, reservation and VSP contracts will print the price; if TVA must be shown separately we need the rate(s) per unit type (housing vs. commercial).
