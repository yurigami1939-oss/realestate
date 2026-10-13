import { and, eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { loadTenantAccess } from "@/server/entitlements/access";
import { setUnitFloorPlan } from "@/server/inventory/floor-plans";
import { createAccountSchema } from "@/server/treasury/schemas";
import { createAccount } from "@/server/treasury/service";

import { createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { buildExportBundle } from "./bundle";

afterAll(async () => {
  await stopEnqueue();
});

const t = (key: string) => key;

describe("the organization's data in one zip (CLAUDE.console.md §17 step 10)", () => {
  it("bundles every export and the index of the stored files, for the gérant only", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const { fileId } = await setUnitFloorPlan(team.manager, {
      unitId: setup.unitIds[0] ?? "",
      upload: {
        fileName: "Plan A-03-01.pdf",
        bytes: new TextEncoder().encode("%PDF-1.7\nplan\n%%EOF"),
      },
    });
    // A name a spreadsheet would run as a formula.
    await setUnitFloorPlan(team.manager, {
      unitId: setup.unitIds[1] ?? "",
      upload: {
        fileName: "=HYPERLINK(x).pdf",
        bytes: new TextEncoder().encode("%PDF-1.7\nplan\n%%EOF"),
      },
    });
    // A bank account opened two years ago: the journals and its ledger come one file per year.
    const year = Number(todayInAlgiers().slice(0, 4));
    await createAccount(
      team.owner,
      createAccountSchema.parse({
        kind: "bank",
        name: "BNA",
        bankName: "BNA",
        accountNumber: "",
        isDefault: true,
        notes: "",
        openingBalance: "100 000",
        openingOn: `${year - 2}-01-01`,
      }),
    );
    // The treasury switched off by the gérant (its data is still the organization's own).
    const access = await loadTenantAccess(team.orgId);
    const owner: TenantCtx = {
      ...team.owner,
      access: { ...access, modules: access.modules.filter((m) => m !== "treasury") },
    };

    await expect(buildExportBundle(team.manager, "fr", t)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { file, bytes } = await buildExportBundle(owner, "fr", t);
    expect(file).toMatch(/^promo-[\w-]+-export-\d{4}-\d{2}-\d{2}\.zip$/);
    const entries = unzipSync(bytes);
    const names = Object.keys(entries);
    // Lists and journals over the whole history (the treasury's without an account yet).
    for (const kind of ["encaissements", "ventes", "lots", "prospects", "acquereurs"]) {
      expect(names.some((n) => n.startsWith("exports/") && n.includes(kind))).toBe(true);
    }
    expect(names.every((n) => n === "fichiers.csv" || n.endsWith(".xlsx"))).toBe(true);
    const count = (part: string) => names.filter((n) => n.includes(part)).length;
    expect(count("encaissements")).toBe(3);
    // Each year of the bank account's ledger (from the module switched off).
    expect(count("tresorerie-")).toBe(3);
    expect(count("ecritures")).toBe(3);
    const index = strFromU8(entries["fichiers.csv"] ?? new Uint8Array());
    expect(index).toContain("Plan A-03-01.pdf");
    expect(index).toContain(`/api/files/${fileId}?download`);
    expect(index).toContain("'=HYPERLINK(x).pdf");

    const audit = await withTenant(team.owner, (tx) =>
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
    expect(audit).toHaveLength(1);
    expect(audit[0]?.after).toMatchObject({ files: 2, tooLarge: [] });
  });
});
