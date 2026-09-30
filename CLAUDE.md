# CLAUDE.md — <PRODUCT_NAME>

> Permanent source of truth for every session. Read it fully before working.
> Update **§11 Roadmap** at the end of every session and **§12 Decisions log** whenever a decision is taken.

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

Versions = latest stable on npm on 2026-09-30. Exact versions are pinned in `package.json` at scaffold; keep this table in sync.

| Area | Package / tool | Version |
|---|---|---|
| Runtime | Node.js (`engines >=22.12`, local 22.22.0) · pnpm | 22 LTS · 10.32 |
| Framework | `next` (App Router, Turbopack) · `react` · `react-dom` | 16.3.7 · 19.3.0 · 19.3.0 |
| Language | `typescript` (`strict`, `noUncheckedIndexedAccess`) | **6.0.3** (not 7.x, see §12) |
| Database | PostgreSQL, Docker `postgres:18.6-alpine` | 18 |
| ORM | `drizzle-orm` · `drizzle-kit` · `pg` | 0.45.3 · 0.31.11 · 8.23.0 |
| Auth | `better-auth` + `organization` plugin | 1.7.6 |
| Validation | `zod` | 4.6.5 |
| UI | `tailwindcss` · shadcn/ui (CLI `shadcn`) · `@tanstack/react-table` | 4.3.3 · 4.21.0 · 9.2.4 |
| Forms | `react-hook-form` · `@hookform/resolvers` | 7.89.0 · 5.9.1 |
| i18n | `next-intl` | 4.14.8 |
| Jobs | `pg-boss` | 12.35.0 |
| PDF | `@react-pdf/renderer` (engine confirmed after Arabic spike, §12) | 4.9.0 |
| Files | `@aws-sdk/client-s3` · `@aws-sdk/s3-request-presigner` · SeaweedFS (local S3) | 3.1143.0 · `chrislusf/seaweedfs:4.48` |
| Email | `nodemailer` · Mailpit (local SMTP catcher) | 10.0.13 · `axllent/mailpit:v1.31` |
| Dates | `date-fns` · `@date-fns/tz` | 4.4.0 · 1.5.0 |
| Phones | `libphonenumber-js` | 1.13.14 |
| Tests | `vitest` · `@playwright/test` | 5.0.3 · 1.63.0 |
| Tooling | `eslint` + `eslint-config-next` (flat config) · `prettier` + `prettier-plugin-tailwindcss` · `tsx` | 10.11.0 + 16.3.7 · 3.9.9 + 0.8.1 · 4.23.15 |

Adding a runtime dependency = one line in §12.

## 3. Commands

| Command | Does |
|---|---|
| `pnpm docker:up` / `pnpm docker:down` | Start / stop Postgres (dev, test, e2e DBs), SeaweedFS (S3), Mailpit |
| `pnpm dev` | Next dev server → http://localhost:3000 (Mailpit UI → http://localhost:8025) |
| `pnpm worker` | pg-boss worker (separate process; required for jobs) |
| `pnpm build` · `pnpm start` | Production build · serve |
| `pnpm lint` | ESLint + RTL class check (no physical-direction Tailwind classes) |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm format` | Prettier write |
| `pnpm test` · `pnpm test:watch` | Vitest unit + integration against `realestate_test` (needs `docker:up`) |
| `pnpm e2e` | Playwright against a built app + freshly seeded `realestate_e2e` |
| `pnpm db:generate` | drizzle-kit: generate SQL migration from `src/db/schema` |
| `pnpm db:migrate` | Apply migrations as owner role (+ grants, RLS policies, pg-boss schema) |
| `pnpm db:seed` | Wipe dev data and seed the demo promoter |
| `pnpm db:reset` | Drop + recreate dev DB, migrate, seed |
| `pnpm db:studio` | Drizzle Studio |
| `pnpm check` | lint + typecheck + test — the CI script; must be green before a step is "done" |

## 4. Repository structure

```
.
├── CLAUDE.md                 # this file
├── docker-compose.yml        # postgres:18, seaweedfs (S3), mailpit
├── docker/                   # init SQL (roles, dev/test/e2e DBs), S3 config
├── drizzle.config.ts         # drizzle-kit config (owner connection, snake_case casing)
├── messages/                 # next-intl catalogs: fr.json, ar.json (same keys)
├── public/                   # static assets; fonts/ also embedded in PDFs
├── scripts/                  # migrate, reset, seed runner, rtl-lint (tsx)
├── e2e/                      # Playwright specs + fixtures
├── tests/                    # Vitest setup, DB helpers, factories
├── .github/workflows/        # CI: pnpm check with a Postgres service
└── src/
    ├── proxy.ts              # Next 16 proxy (ex-middleware): locale routing + optimistic auth redirect only
    ├── env.ts                # zod-validated environment (fail fast at boot)
    ├── app/
    │   ├── [locale]/
    │   │   ├── (auth)/       # sign-in, sign-up, accept invitation, reset password
    │   │   ├── (app)/        # back-office shell (sidebar, org switcher) + module routes
    │   │   └── (portal)/     # buyer/resident portal (Phase 2)
    │   └── api/              # Route Handlers only: auth, files, webhooks, future /api/v1
    ├── components/
    │   ├── ui/               # shadcn/ui primitives (generated, minimal edits)
    │   └── <area>/           # shared composites: data-table, money-input, app-shell…
    ├── db/
    │   ├── schema/           # Drizzle tables, one file per module + index.ts
    │   ├── migrations/       # drizzle-kit SQL + hand-written SQL (RLS, grants)
    │   ├── seed/             # demo promoter seed, grows with each module
    │   ├── client.ts         # pg Pool + drizzle (app role), server-only
    │   └── tenant.ts         # withTenant(ctx, fn): transaction + set_config('app.current_org')
    ├── server/
    │   ├── auth/             # Better Auth config, session → TenantCtx, roles & permissions
    │   ├── audit/            # recordAudit()
    │   ├── numbering/        # nextDocumentNumber() — gapless counters
    │   ├── files/            # S3 client, upload/download, file records
    │   ├── email/            # transport + templates
    │   └── <module>/         # schemas.ts (zod, isomorphic) · queries.ts · service.ts · actions.ts · *.test.ts
    ├── jobs/                 # pg-boss worker entry, job definitions, enqueue()
    ├── pdf/                  # PDF templates (receipt, contracts, payment/charge calls) + font registration
    ├── i18n/                 # next-intl routing, request config, navigation helpers
    └── lib/                  # pure isomorphic utils: result, app-error, money, amount-in-words, dates, phone
```

Page-specific components live next to their route in `_components/`; reused ones in `src/components/<area>/`.

## 5. Architecture rules

### Multi-tenancy
- Tenant = Better Auth `organization`. Every tenant-owned table has `organization_id uuid not null references organization(id)`, leading column of its composite indexes/uniques.
- **RLS** on every tenant table: `ENABLE` + `FORCE ROW LEVEL SECURITY`, policy `tenant_isolation`:
  `USING (organization_id = current_setting('app.current_org', true)::uuid) WITH CHECK (same)`. Unset setting → zero rows.
- **Two DB roles**: `realestate_owner` (owns schema; migrations, seed) and `realestate_app` (runtime; `NOSUPERUSER NOBYPASSRLS`, DML grants only). The app never connects as owner.
- `withTenant(ctx, fn)` opens a transaction, runs `set_config('app.current_org', ctx.orgId, true)` (tx-local, pool-safe) and hands `tx` to `fn`. Every tenant read/write goes through it.
- Global (non-RLS) tables: Better Auth tables (`user`, `session`, `account`, `verification`, `organization`, `member`, `invitation`) and reference data (wilayas, communes). Accessed only via `src/server/auth` or read-only helpers.
- A catalog test fails CI if any table with `organization_id` lacks RLS enabled + forced + policy.
- `organization_id` always comes from the session, never from client input.
- Portal users (`resident` role) are additionally filtered by their linked `buyer_id` / `resident_id` in the service layer.

### Data access
- `src/server/<module>/queries.ts` (reads) and `service.ts` (mutations + domain rules) take `ctx: TenantCtx` first and start with `import 'server-only'`. Functions accept an optional `tx` to compose several operations in one transaction.
- ESLint `no-restricted-imports`: `@/db/*` and `drizzle-orm` importable only from `src/db`, `src/server`, `src/jobs`, `scripts`, `tests`.
- Server Components call `queries.ts` directly. Client Components receive data via props or Server Actions.
- `schemas.ts` must stay isomorphic (no server-only imports) — it is shared with client forms.

### Mutations
- Server Actions in `src/server/<module>/actions.ts` (`'use server'`), each built with `defineAction({ input: zodSchema, permission }, handler)`: parse → resolve `TenantCtx` from session → `assertCan` → call service → revalidate → return `Result<T, AppError>`. Actions never throw to the client.
- Route Handlers only for: Better Auth (`/api/auth/[...all]`), file upload/download, webhooks (SATIM, WhatsApp), future mobile API (`/api/v1/*`).

### Auth & roles
- Better Auth: email + password, organization plugin, invitations by email. `session.activeOrganizationId` = current tenant; the org switcher changes it.
- IDs of Better Auth tables are `uuid` (DB default `uuidv7()`), so FKs to `organization.id` are `uuid`.
- Roles via Better Auth access control (`createAccessControl`); a member may hold several roles. Permissions are `resource:action` strings in `src/server/auth/permissions.ts`.
- `getTenantCtx()` → `{ userId, orgId, roles, locale }`. `assertCan(ctx, 'payment:cancel')` runs **in the service layer**; UI uses the same `can()` only to hide controls.
- `proxy.ts` does locale routing and a cookie-presence redirect only — never authorization.

| Role | FR | Initial scope (refined per module) |
|---|---|---|
| `owner` | Gérant | Everything: members, settings, prices, cancellations, exports |
| `sales_manager` | Directeur commercial | All CRM & sales, price lists, lead assignment, discounts, targets |
| `sales_agent` | Commercial | Own leads/visits/quotations; options & reservations; read inventory |
| `accountant` | Comptable | Read all finance; cancel payments/receipts; registers; exports |
| `cashier` | Caissier | Record payments, issue receipts; read buyers & schedules |
| `property_manager` | Gestionnaire / syndic | Residence module (Phase 2) |
| `resident` | Acquéreur / résident | Portal only, own records only |

### Jobs (pg-boss)
- pg-boss tables live in schema `pgboss`, created by `db:migrate` (owner); runtime uses the app role with `migrate: false`.
- Worker = separate Node process (`pnpm worker`). Next.js only enqueues via `enqueue()`.
- Every payload carries `organizationId`; handlers run inside `withTenant`. Handlers are idempotent (`singletonKey`, idempotency checks). Money in payloads = decimal string of centimes.
- Planned: option expiry (scheduled at creation + 15-min sweep), overdue reminders (daily 08:00 Algiers), milestone → payment calls, charge calls generation, lease renewal alerts.

### Files
- S3 API only. Local: SeaweedFS. Production: any S3-compatible provider (hosting location TBD, §12).
- Private bucket. Key: `org/{orgId}/{entity}/{entityId}/{uuid}.{ext}`; a tenant-scoped `file` row holds metadata (name, MIME, size, uploader).
- Upload via Route Handler (auth + permission + MIME allow-list + max 20 MB). Download via presigned GET (5 min) after a permission check.
- Issued documents (receipts, contracts, calls) are rendered once at issue; the stored PDF is served for reprints.

### Caching
- Tenant data is dynamic by default. Any `use cache` / cached function on tenant data must include `orgId` in its key and be tagged `org:{orgId}:{entity}`.

### Config
- All env vars declared and validated in `src/env.ts`; `.env.example` lists them: `DATABASE_URL` (app role), `DATABASE_OWNER_URL`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `S3_*`, `SMTP_*`.

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
| Prospect | `lead` | `lead_source`: `facebook`, `instagram`, `whatsapp`, `ouedkniss`, `walk_in`, `referral`, `phone`, `website`, `other` |
| Visite | `visit` | |
| Relance | `follow_up` | |
| Devis / Simulation | `quotation` | |
| Commission / Objectif | `commission` / `sales_target` | |
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
| RC, NIF, NIS, AI (identifiants légaux SARL) | `organization.rc_number`, `nif`, `nis`, `ai_number` | printed on documents |
| Wilaya / Commune | `wilaya` / `commune` | global reference tables |

## 7. Domain rules & invariants

### Money
- DZD stored as **`bigint` centimes** (Drizzle `bigint({ mode: 'bigint' })`), JS **`bigint`** in code, branded type `Centimes`. Never `number`, float, `numeric`, `real`.
- `src/lib/money/`: `parseDZD()`, `formatDZD(amount, locale)` (fr `1 250 000,00 DA`, ar `1 250 000,00 د.ج`, Latin digits), `amountInWordsFr()`, `amountInWordsAr()`, `allocate(total, weights)` (largest remainder — parts always sum to total), `applyRate(amount, basisPoints)` (round half-up to the centime).
- Rates/percentages stored as integer **basis points** (1 % = 100 bp).
- Receipts print the amount in words (FR and/or AR), e.g. « Arrêté le présent reçu à la somme de : un million deux cent cinquante mille dinars algériens ».
- Outside TS (JSON payloads, exports, API): decimal string of centimes.

### Dates
- Instants → `timestamptz` (UTC). Calendar dates (due dates, birth dates, contract dates) → `date` = an Algiers calendar day.
- "Today", display and document year are computed in `Africa/Algiers` (UTC+1, no DST) via `src/lib/dates`. Never derive them from server-local time.
- Display `dd/MM/yyyy` in both locales.

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
- Table `document_sequence(organization_id, doc_type, year, last_value)`. `nextDocumentNumber(tx, docType, issueDate)` upserts the row (`ON CONFLICT DO NOTHING`), then `SELECT … FOR UPDATE`, increments, and **must run in the same transaction as the document insert** — a rollback leaves no gap.
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
- **Only** `transitionUnit(ctx, tx, unitId, to, { reason, refType, refId })` (in `src/server/inventory/`) writes `unit.status`; it validates, writes `unit_status_history` and `audit_log`.
- Reservation transfer: unit stays `reserved`, buyer changes. Unit swap: A `reserved → available` + B `available → reserved` in one transaction.

### Pricing
- Unit price changes write `unit_price_history` + audit. A reservation **snapshots** the agreed price and discount; later price-list changes never touch it.

### Payment schedule, calls, payments
- Sum of `installment.amount` == contract price exactly (built with `allocate`).
- Installment trigger: `date` (fixed `due_date`) or `milestone` (`construction_milestone_id`; `due_date` = validation date + org-configured delay).
- Validating a milestone enqueues one job that issues one numbered `payment_call` per concerned buyer, idempotently.
- "Overdue" is **derived** (`due_date < today_algiers AND balance > 0`), never stored.
- Each payment issues exactly one receipt. Allocation of a payment across installments: rule pending (§12).
- Payments and receipts are **immutable**: no update, no delete. Cancel = `status = cancelled` + `cancelled_at`, `cancelled_by`, mandatory `cancellation_reason`; allocations reversed; audited.

### Residence charges
- `share` = integer weight per unit per residence (tantièmes, e.g. on a 10 000 basis).
- Distribution keys: `equal`, `share`, `per_building`, `custom` (explicit unit list, weighted `equal` or `share`, e.g. RDC excluded from elevator). Every distribution uses `allocate()` → lines sum exactly to the charge.

### Audit & deletion
- Audited: prices, payments, receipts, contracts (reservation, sale), installments/schedules, unit status, members & roles.
- `audit_log(organization_id, actor_user_id, action, entity_type, entity_id, before jsonb, after jsonb, reason, created_at)` written by `recordAudit(tx, …)` in the same transaction as the change. `action` is semantic, e.g. `receipt.cancel`.
- DB grants enforce it: app role has no `UPDATE`/`DELETE` on `audit_log`, and no `DELETE` on `payment` / `receipt`.
- Business records are soft-deleted (`deleted_at`, `deleted_by`); queries exclude them by default.

## 8. Coding conventions

| Thing | Convention | Example |
|---|---|---|
| Tables | snake_case, singular | `payment_call` |
| Columns | snake_case; FK `<entity>_id`; standard `id uuid default uuidv7()`, `created_at`, `updated_at`, `created_by`, `deleted_at` | `unit_id` |
| Drizzle | camelCase TS props, `casing: 'snake_case'` | `unitId` |
| Enums | Postgres enums, snake_case values, defined once as `const` arrays reused by Drizzle and Zod | `unitStatuses` |
| Files | kebab-case | `payment-schedule.ts` |
| Server functions | verb-first | `createReservation`, `listUnits` |
| Server Actions | `<verb><Entity>Action` | `cancelReceiptAction` |
| Permissions | `resource:action` | `receipt:cancel` |
| i18n keys | English camelCase, namespaced by module | `sales.reservation.createTitle` |
| Commits | Conventional Commits, small | `feat(inventory): add unit status machine` |

- **Validation**: one Zod schema per input in `schemas.ts`, used by both the form (`zodResolver`) and the action. Parse at every boundary: actions, route handlers, job payloads, env, seed input.
- **Result & errors**: `type Result<T> = { ok: true; data: T } | { ok: false; error: AppError }`. `AppError { code, messageKey, fieldErrors?, details? }`, codes: `VALIDATION`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `INVALID_TRANSITION`, `UNEXPECTED`. Services throw `AppError`; `defineAction` converts to `Result`. Unexpected errors are logged server-side and returned as `UNEXPECTED` without internals.
- **i18n**: no hard-coded UI strings; every key added to `fr.json` **and** `ar.json` in the same change. Arabic = Modern Standard Arabic. Latin digits (0-9) in both locales. `<html lang dir>` set from locale. Error messages resolved from `messageKey`.
- **RTL/UI**: Tailwind logical utilities only (`ms-/me-/ps-/pe-/start-/end-/text-start/rounded-s/border-e`); directional icons flip with `rtl:`. shadcn/ui for primitives; one shared `DataTable` on TanStack Table (server-side pagination/filter via search params for large lists); forms with react-hook-form. Font pair (Latin + Arabic) chosen at scaffold and reused in PDFs.
- **TypeScript**: no `any`, no `!` non-null assertions outside tests, `import type` for types, exhaustive `switch` with `never` checks on enums.
- **Phones**: stored E.164 (`+213…`) via `libphonenumber-js`; displayed nationally.

## 9. Testing strategy

| Layer | Tool | Scope |
|---|---|---|
| Unit | Vitest (no DB) | `lib/money` (allocate, rates, parsing), amount-in-words FR/AR (table-driven: 0, 1, 11, 16, 21, 71, 80, 81, 91, 100, 200, 1 000, 1 000 000, centimes), dates, status machine, permission matrix |
| Integration | Vitest + real Postgres `realestate_test` | every service function: happy path, forbidden per role, invariants, audit rows written |
| Security | Vitest + Postgres | RLS catalog test (every `organization_id` table has RLS forced + policy); cross-tenant test (org B can neither read nor write org A rows); app role cannot bypass RLS |
| Concurrency | Vitest + Postgres | N parallel `nextDocumentNumber` → exactly 1…N, no gap, no duplicate |
| E2E | Playwright on `realestate_e2e` | sign-in, org switch, FR↔AR RTL; Phase 1 golden path: lead → option → reservation → schedule → payment → receipt PDF |

- Migrations run once in Vitest `globalSetup`. Each test creates its own organization(s) via `tests/factories` → isolation without truncation, parallel-safe.
- No mocking of the database or of RLS. External services (S3, SMTP) use the Docker instances.
- Every service function has at least one integration test; a bug fix starts with a failing test.
- CI (`.github/workflows`) runs `pnpm check` with a Postgres 18 service; e2e runs on main.

## 10. Do / Don't

**Do**
- Go through `withTenant(ctx, …)` for every tenant query; take `orgId` from the session only.
- Check permissions in the service layer (`assertCan`), even if the UI hides the control.
- Issue numbers, write audit and change status inside the same transaction as the business write.
- Run `pnpm check` before calling a step done; add FR **and** AR keys together.
- Ask the user before any ambiguous business rule; log the answer in §12.

**Don't**
- Don't import `@/db` or `drizzle-orm` outside `src/db`, `src/server`, `src/jobs`, `scripts`, `tests`.
- Don't store or compute money as `number`/float; don't `Number()` an amount.
- Don't write `unit.status` outside `transitionUnit()`.
- Don't update/delete payments, receipts or audit rows — cancel with a reason.
- Don't reuse, skip or edit document numbers.
- Don't connect the app as table owner/superuser (RLS bypass).
- Don't cache tenant data without `orgId` in the key.
- Don't use physical-direction Tailwind classes (`ml-`, `pr-`, `left-`, `text-right`…).
- Don't run long work in a request — enqueue a job.
- Don't commit secrets; `.env*` is git-ignored except `.env.example`.

## 11. Roadmap

**Current: Phase 0 — awaiting approval of this file.**

### Phase 0 — Foundations
- [ ] `CLAUDE.md` approved
- [ ] Scaffold: Next 16 + TS strict, ESLint/Prettier, pnpm, git init
- [ ] Docker Compose: Postgres 18 (dev/test/e2e DBs, 2 roles), SeaweedFS + bucket, Mailpit
- [ ] Drizzle setup, `withTenant`, RLS migration pattern, RLS catalog + cross-tenant tests
- [ ] Core libs: `Result`/`AppError`, `defineAction`, money + amount in words FR/AR, dates, `nextDocumentNumber`, `recordAudit`
- [ ] Better Auth: email/password, organizations, custom roles, invitations (Mailpit)
- [ ] i18n FR/AR + RTL, locale switcher
- [ ] App shell: sidebar, org switcher, user menu
- [ ] pg-boss worker skeleton + one demo job
- [ ] PDF spike: bilingual FR/AR receipt → confirm PDF engine
- [ ] CI workflow (`pnpm check`)
- [ ] Seed: demo promoter org + one user per role (inventory/CRM/sales data added with their modules)

### Phase 1 — MVP
- [ ] Module 1 — Projects & inventory (units, price lists, availability grid)
- [ ] Module 2 — Sales CRM (leads, dedup, pipeline, visits, follow-ups, simulator, quotation PDF, commissions)
- [ ] Module 3 — Reservation & sale (buyer file, reservation, VSP, schedule, payments, receipts, reminders, penalties, withdrawal, transfer, swap, bank loans)
- [ ] Owner dashboard
- [ ] Audit log viewer
- [ ] Seed: 2 projects, 3 buildings, ~120 units, leads, buyers, payments

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
| 2026-09-30 | Drizzle 0.45.x (stable); 1.0 is still RC — migrate when stable. |
| 2026-09-30 | PostgreSQL 18: native `uuidv7()` for all primary keys. |
| 2026-09-30 | **Proposed** — SeaweedFS replaces MinIO for local S3: `minio/minio` is no longer published on Docker Hub. App code only uses the S3 API. |
| 2026-09-30 | **Proposed** — Mailpit + nodemailer added for invitation/reset emails in dev. |
| 2026-09-30 | Money as JS `bigint` end-to-end (Drizzle `mode: 'bigint'`); rates in basis points; splits via largest-remainder `allocate()`. |
| 2026-09-30 | Two DB roles (owner / app); RLS forced; app role has no UPDATE/DELETE on `audit_log`, no DELETE on payments/receipts. |
| 2026-09-30 | pg-boss worker runs as a separate process; its schema is installed by `db:migrate`. |
| 2026-09-30 | Calendar dates as `date`, instants as `timestamptz`. |
| 2026-09-30 | **Proposed** — Copropriétaire → `co_owner` (glossary said `owner`, which clashes with the `owner` role). |
| 2026-09-30 | **Proposed** — Members may hold several roles (small teams: accountant + cashier). |
| 2026-09-30 | **Proposed** — `@react-pdf/renderer` kept pending a Phase 0 spike on Arabic shaping/bidi; fallback: HTML templates → PDF via headless Chromium in the worker (also eases editable templates). |
| 2026-09-30 | **Proposed** — Phase 0 seed covers org + users per role; projects/units/leads/buyers/payments seeded as their schemas land in Phase 1. |

### Open business questions (ask before implementing)
- Late penalty formula (rate, base, grace period, cap) — and check décret 13-431.
- Withdrawal: refund vs retention (% or fixed), deadlines, who approves.
- Allocation of a payment across installments (oldest due first?) and handling of overpayment.
- Cheques: receipt issued on reception ("sous réserve d'encaissement") or on clearance; bounced cheque flow.
- Default option duration; max simultaneous options per agent/lead.
- Receipt/contract language: bilingual FR/AR on one document, or per-buyer choice.
- VSP payment tranches: enforce legal percentages per milestone or free schedule?
- Commission rules (base, rate, trigger: reservation, VSP, or full payment).
- Hosting location (Loi 18-07 restricts cross-border transfer of personal data).
