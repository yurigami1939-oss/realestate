/**
 * `pnpm console:purge <organizationId> [--confirm "<legal name>"]` (owner connection,
 * CLAUDE.console.md §17 step 10): deletes a terminated organization's data once its retention
 * is over — a dry run listing what would go unless `--confirm` repeats its legal name exactly.
 * The console keeps the client account, its invoices, payments and audit trail.
 */
import { purgeOrganization } from "@/db/purge";

const [organizationId, ...rest] = process.argv.slice(2);
const at = rest.indexOf("--confirm");
const confirm = at >= 0 ? (rest[at + 1] ?? null) : null;
const ownerUrl = process.env.DATABASE_OWNER_URL;
if (!organizationId)
  throw new Error('Usage: pnpm console:purge <organizationId> [--confirm "<legal name>"]');
if (!ownerUrl) throw new Error("DATABASE_OWNER_URL is required");

const report = await purgeOrganization({ ownerUrl, organizationId, confirm }).catch(
  (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
const rows = report.tables.filter((t) => t.rows > 0);
console.log(`${report.legalName} — terminated on ${report.terminatedOn}`);
for (const t of rows) console.log(`  ${t.table.padEnd(32)} ${t.rows}`);
console.log(
  `  ${rows.reduce((sum, t) => sum + t.rows, 0)} rows in ${rows.length} tables, ${report.users} accounts, ${report.objects} stored files`,
);
console.log(
  report.executed
    ? "Purged. The console keeps the client account, its invoices, payments and audit trail."
    : `Dry run: nothing deleted. To purge: pnpm console:purge ${organizationId} --confirm "${report.legalName}"`,
);
process.exit(0);
