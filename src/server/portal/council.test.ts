import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, portalLink, resident } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createChargeCategory } from "@/server/charges/categories";
import { createChargeCategorySchema } from "@/server/charges/schemas";
import { addResidentSchema, createResidenceSchema } from "@/server/residences/schemas";
import { addResident, createResidence, setCouncilMember } from "@/server/residences/service";
import { recordInvoice } from "@/server/suppliers/invoices";
import { createInvoiceSchema, createSupplierSchema } from "@/server/suppliers/schemas";
import { createSupplier } from "@/server/suppliers/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import type { PortalCtx } from "./context";
import { getPortalCouncil, isPortalCouncilInvoice } from "./council";

afterAll(async () => {
  await stopEnqueue();
});

/** A portal account linked to a resident record, as an accepted invitation. */
async function portalAccount(staff: TenantCtx, residentId: string): Promise<PortalCtx> {
  const member = await addMember(staff.orgId, ["resident"]);
  await withTenant(staff, (tx) =>
    tx.insert(portalLink).values({
      organizationId: staff.orgId,
      email: `client-${randomUUID().slice(0, 8)}@example.test`,
      userId: member.userId,
      residentId,
      createdBy: staff.userId,
    }),
  );
  return { userId: member.userId, orgId: staff.orgId, name: "Résident", locale: "fr" };
}

describe("residents' council", () => {
  it("lets the council's co-owners read the residence's accounts", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const manager = await addMember(team.orgId, ["property_manager"]);
    const year = Number(todayInAlgiers().slice(0, 4));
    const { id: residenceId } = await createResidence(
      manager,
      createResidenceSchema.parse({
        projectId: setup.projectId,
        name: "Résidence Les Oliviers",
        shareBasis: "10000",
        chargeFrequency: "quarterly",
        reserveFund: "0",
        callDueDays: "30",
      }),
    );
    const person = (unitId: string, kind: "co_owner" | "occupant", lastName: string) =>
      addResident(
        manager,
        addResidentSchema.parse({
          residenceId,
          unitId,
          kind,
          isMain: kind === "co_owner",
          lastName,
          firstName: "Nadia",
          email: "",
          sinceOn: `${year}-01-01`,
        }),
      );
    await person(setup.unitIds[0], "co_owner", "Ouali");
    await person(setup.unitIds[1], "occupant", "Saadi");
    const [owner, occupant] = await withTenant(manager, (tx) =>
      tx
        .select({ id: resident.id, kind: resident.kind })
        .from(resident)
        .where(eq(resident.residenceId, residenceId))
        .orderBy(resident.kind),
    );
    const coOwnerId = owner?.kind === "co_owner" ? owner.id : (occupant?.id ?? "");
    const occupantId = owner?.kind === "occupant" ? owner.id : (occupant?.id ?? "");

    // An invoice of the year, booked to a category.
    const { id: categoryId } = await createChargeCategory(
      manager,
      createChargeCategorySchema.parse({
        residenceId,
        name: "Ascenseur",
        nameAr: "",
        key: "share",
        weighting: "share",
        buildingId: "",
        unitIds: [],
      }),
    );
    const { id: supplierId } = await createSupplier(
      manager,
      createSupplierSchema.parse({ name: "Otis Algérie", activity: "", phone: "", email: "" }),
    );
    const { id: invoiceId } = await recordInvoice(
      manager,
      createInvoiceSchema.parse({
        supplierId,
        residenceId,
        categoryId,
        contractId: "",
        number: "F-001",
        invoiceOn: `${year}-01-15`,
        dueOn: "",
        label: "Maintenance",
        amount: "50 000",
        fromReserve: false,
        notes: "",
      }),
    );

    const coOwner = await portalAccount(manager, coOwnerId);
    expect(await getPortalCouncil(coOwner, residenceId, year)).toBeNull();

    await expect(
      setCouncilMember(team.agentA, { residentId: coOwnerId, member: true }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      setCouncilMember(manager, { residentId: occupantId, member: true }),
    ).rejects.toMatchObject({ messageKey: "residences.council.errors.notCoOwner" });
    await setCouncilMember(manager, { residentId: coOwnerId, member: true });

    const council = await getPortalCouncil(coOwner, residenceId, year);
    expect(council?.report.lines).toMatchObject([{ name: "Ascenseur", spent: 5_000_000n }]);
    expect(council?.invoices.map((i) => [i.supplierName, i.number])).toEqual([
      ["Otis Algérie", "F-001"],
    ]);
    expect(
      await withTenant(coOwner, (tx) => isPortalCouncilInvoice(tx, coOwner.userId, invoiceId)),
    ).toBe(true);

    // An occupant, or a co-owner off the council, reads nothing.
    const tenant = await portalAccount(manager, occupantId);
    expect(await getPortalCouncil(tenant, residenceId, year)).toBeNull();
    expect(
      await withTenant(tenant, (tx) => isPortalCouncilInvoice(tx, tenant.userId, invoiceId)),
    ).toBe(false);
    await setCouncilMember(manager, { residentId: coOwnerId, member: false });
    expect(await getPortalCouncil(coOwner, residenceId, year)).toBeNull();

    const audits = await withTenant(manager, (tx) =>
      tx
        .select({ id: auditLog.id })
        .from(auditLog)
        .where(and(eq(auditLog.action, "resident.council"), eq(auditLog.entityId, residenceId))),
    );
    expect(audits).toHaveLength(2);
  });
});
