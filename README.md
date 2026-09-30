# PRODUCT_NAME

Multi-tenant SaaS for Algerian real-estate developers: promotion sales (inventory, CRM, reservations, VSP, payments, receipts) and residence management after delivery. French and Arabic (RTL).

The full product, architecture, rules and roadmap live in [CLAUDE.md](CLAUDE.md).

## Requirements

Node.js 22.12+, pnpm 10, Docker.

## Getting started

```bash
pnpm install
cp .env.example .env
pnpm docker:up                          # Postgres :5433, SeaweedFS :8333, Mailpit :8025
pnpm exec playwright install chromium   # PDF rendering and e2e tests
pnpm db:reset                           # migrate + seed the demo promoter
pnpm dev                                # http://localhost:3000
pnpm worker                             # background jobs (emails…), in a second terminal
```

Demo accounts (one per role) are listed in `src/db/seed/demo.ts`. Outgoing emails appear in Mailpit at http://localhost:8025.

## Quality gate

```bash
pnpm check   # lint + typecheck + unit/integration tests
pnpm e2e     # Playwright on a production build
```
