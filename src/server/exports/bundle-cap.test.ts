import { and, eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, describe, expect, it, vi } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";

import { createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import type * as Xlsx from "./xlsx";

// Two rows at most per export: the sale's three units go beyond it.
vi.mock("./xlsx", async (importOriginal) => ({
  ...(await importOriginal<typeof Xlsx>()),
  MAX_EXPORT_ROWS: 2,
}));

const { buildExportBundle, yearsOf } = await import("./bundle");

afterAll(async () => {
  await stopEnqueue();
});

const t = (key: string) => key;

describe("the bundle's limits (CLAUDE.console.md §17 step 10)", () => {
  it("cuts the years from 2000 at the earliest, whatever year a typo gives", () => {
    expect(yearsOf(2024, "2026-03-10")).toEqual([
      { from: "2000-01-01", to: "2024-12-31" },
      { from: "2025-01-01", to: "2025-12-31" },
      { from: "2026-01-01", to: "2026-03-10" },
    ]);
    expect(yearsOf(26, "2001-05-02")).toEqual([
      { from: "2000-01-01", to: "2000-12-31" },
      { from: "2001-01-01", to: "2001-05-02" },
    ]);
    expect(yearsOf(2030, "2026-03-10")).toEqual([{ from: "2000-01-01", to: "2026-03-10" }]);
  });

  it("names the exports beyond the row cap in manquants.txt and builds the rest", async () => {
    const team = await createSalesTeam();
    await createSaleSetup(team);
    const { bytes } = await buildExportBundle(team.owner, "fr", t);
    const entries = unzipSync(bytes);
    const missing = strFromU8(entries["manquants.txt"] ?? new Uint8Array());
    expect(missing).toContain("exports.bundle.tooLarge");
    expect(missing).toContain("units");
    expect(Object.keys(entries)).toContain("fichiers.csv");

    const [audit] = await withTenant(team.owner, (tx) =>
      tx
        .select({ after: auditLog.after })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.organizationId, team.orgId),
            eq(auditLog.action, "organization.export_bundle"),
          ),
        ),
    );
    expect(audit?.after).toMatchObject({ tooLarge: expect.arrayContaining(["units"]) });
  });
});
