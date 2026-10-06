import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { auditLog, residenceCheckVisit } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { checkState, nextCheckDue } from "@/lib/maintenance";
import { getDashboard } from "@/server/dashboard/queries";
import { getFileDownloadUrl } from "@/server/files/service";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";
import { createSupplierSchema } from "@/server/suppliers/schemas";
import { createSupplier } from "@/server/suppliers/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { createCheckSchema, recordVisitSchema, updateCheckSchema } from "./schemas";
import {
  archiveCheck,
  createCheck,
  listChecks,
  recordVisit,
  setVisitScan,
  updateCheck,
} from "./service";

const today = todayInAlgiers();
const pdf = new TextEncoder().encode("%PDF-1.7\nattestation\n%%EOF");

describe("residence checks", () => {
  it("states a deadline late, coming or in order; the next one follows the frequency", () => {
    expect(checkState(addDays(today, -1), today)).toBe("overdue");
    expect(checkState(today, today)).toBe("due_soon");
    expect(checkState(addDays(today, 30), today)).toBe("due_soon");
    expect(checkState(addDays(today, 31), today)).toBe("ok");
    expect(nextCheckDue("2026-01-31", 1)).toBe("2026-02-28");
    expect(nextCheckDue("2026-10-06", 12)).toBe("2027-10-06");
    expect(nextCheckDue("2026-10-06", null)).toBeNull();
  });

  it("follows a residence's inspections: visits, next deadlines, certificates, dashboard", async () => {
    const team = await createSalesTeam();
    const { projectId } = await createSaleSetup(team);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const accountant = await addMember(team.orgId, ["accountant"]);
    const { id: residenceId } = await createResidence(
      manager,
      createResidenceSchema.parse({
        projectId,
        name: "Résidence Les Oliviers",
        shareBasis: "10000",
        chargeFrequency: "quarterly",
        reserveFund: "5",
        callDueDays: "30",
      }),
    );
    const { id: supplierId } = await createSupplier(
      manager,
      createSupplierSchema.parse({ name: "Otis Algérie", activity: "Ascenseurs" }),
    );
    const input = createCheckSchema.parse({
      residenceId,
      kind: "inspection",
      category: "lift",
      title: "Contrôle annuel de l'ascenseur",
      supplierId,
      frequencyMonths: "12",
      nextDueOn: addDays(today, -10),
      reference: "",
      notes: "",
    });
    await expect(createCheck(accountant, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id: checkId } = await createCheck(manager, input);
    const { id: insuranceId } = await createCheck(
      manager,
      createCheckSchema.parse({
        residenceId,
        kind: "insurance",
        category: "building",
        title: "Assurance multirisque immeuble",
        supplierId: "",
        frequencyMonths: "12",
        nextDueOn: addDays(today, 120),
        reference: "POL-2026-0042",
        notes: "",
      }),
    );

    // Late first; the accountant reads, the dashboard of who keeps residences shows it.
    const listed = await listChecks(accountant, { residenceId });
    expect(listed.map((c) => [c.title, c.state])).toEqual([
      ["Contrôle annuel de l'ascenseur", "overdue"],
      ["Assurance multirisque immeuble", "ok"],
    ]);
    expect((await getDashboard(manager)).todo.checks).toMatchObject([{ id: checkId, late: true }]);
    expect((await getDashboard(accountant)).todo.checks).toBeNull();

    // The visit moves the deadline a year on; never before the visit, never in the future.
    const visit = (overrides: Record<string, string>) =>
      recordVisitSchema.parse({
        checkId,
        doneOn: today,
        supplierId: "",
        result: "remarks",
        notes: "Câble à remplacer sous 3 mois",
        cost: "35 000",
        nextDueOn: nextCheckDue(today, 12),
        ...overrides,
      });
    await expect(recordVisit(manager, visit({ nextDueOn: today }))).rejects.toMatchObject({
      messageKey: "maintenance.errors.nextBeforeVisit",
    });
    await expect(
      recordVisit(manager, visit({ doneOn: addDays(today, 1), nextDueOn: addDays(today, 400) })),
    ).rejects.toMatchObject({ messageKey: "sales.errors.futureDate" });
    const { id: visitId } = await recordVisit(manager, visit({}));
    const [after] = await listChecks(manager, { residenceId });
    expect(after).toMatchObject({ id: insuranceId, state: "ok" });
    const lift = (await listChecks(manager, { residenceId })).find((c) => c.id === checkId);
    expect(lift).toMatchObject({ state: "ok", nextDueOn: nextCheckDue(today, 12) });
    // The visit keeps the check's supplier, its cost and outcome.
    expect(lift?.visits).toMatchObject([
      { result: "remarks", supplierName: "Otis Algérie", cost: 3_500_000n },
    ]);
    expect((await getDashboard(manager)).todo.checks).toEqual([]);

    // The certificate is filed under the check, readable with `residence:read`.
    const { fileId } = await setVisitScan(manager, {
      visitId,
      upload: { fileName: "attestation.pdf", bytes: pdf },
    });
    expect(await getFileDownloadUrl(accountant, fileId, "inline")).toMatch(/^http/);
    await expect(
      getFileDownloadUrl(await addMember(team.orgId, ["sales_agent"]), fileId, "inline"),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    // Visits are kept as recorded.
    await expect(
      withTenant(manager, (tx) =>
        tx.delete(residenceCheckVisit).where(eq(residenceCheckVisit.id, visitId)),
      ),
    ).rejects.toThrow();

    await updateCheck(
      manager,
      updateCheckSchema.parse({
        checkId: insuranceId,
        kind: "insurance",
        category: "building",
        title: "Assurance multirisque immeuble",
        supplierId: "",
        frequencyMonths: "12",
        nextDueOn: addDays(today, 90),
        reference: "POL-2027-0007",
        notes: "Nouvel assureur",
      }),
    );
    await archiveCheck(manager, { checkId: insuranceId });
    await expect(recordVisit(manager, visit({ checkId: insuranceId }))).rejects.toMatchObject({
      messageKey: "maintenance.errors.archived",
    });
    expect((await listChecks(manager, { residenceId })).map((c) => c.id)).toEqual([checkId]);
    expect(
      (await listChecks(manager, { residenceId, archived: true })).map((c) => c.id).sort(),
    ).toEqual([checkId, insuranceId].sort());

    const actions = await withTenant(manager, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.entityId, residenceId)),
    );
    expect(actions.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "residence_check.create",
        "residence_check.visit",
        "residence_check.update",
        "residence_check.archive",
      ]),
    );
  });
});
