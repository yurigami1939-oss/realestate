import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, file, project, reservation } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { getDashboard } from "@/server/dashboard/queries";
import { listDeliveries } from "@/server/handovers/queries";
import { companySettingsSchema } from "@/server/organizations/schemas";
import { updateCompanySettings } from "@/server/organizations/settings";
import { getSale } from "@/server/sales/sale-queries";
import {
  createReservation,
  recordSale,
  setReservationScan,
  updateReservationContract,
} from "@/server/sales/reservations";
import {
  createReservationSchema,
  recordSaleSchema,
  reservationContractSchema,
} from "@/server/sales/schemas";

import { addMember, companySettingsInput, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { listProjectDocuments } from "./queries";
import { createProjectDocumentSchema, updateProjectDocumentSchema } from "./schemas";
import {
  createProjectDocument,
  deleteProjectDocument,
  setProjectDocumentScan,
  updateProjectDocument,
} from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();
const pdf = () => ({
  fileName: "piece.pdf",
  bytes: new TextEncoder().encode("%PDF-1.7\nscan\n%%EOF"),
});

const documentInput = (projectId: string, overrides: Record<string, string> = {}) =>
  createProjectDocumentSchema.parse({
    projectId,
    kind: "building_permit",
    title: "",
    reference: "PC 16/0987/2024",
    issuedOn: "2024-03-12",
    expiresOn: "",
    issuer: "APC de Draria",
    notes: "",
    ...overrides,
  });

describe("promoter's obligations", () => {
  it("keeps a project's regulatory file with its scans, rights, audit and alerts", async () => {
    const team = await createSalesTeam();
    const { projectId } = await createSaleSetup(team);
    await expect(
      createProjectDocument(team.agentA, documentInput(projectId)),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      createProjectDocumentSchema
        .safeParse({
          projectId,
          kind: "other",
          title: "",
          issuedOn: "2026-01-10",
          expiresOn: "2025-01-10",
        })
        .error?.issues.map((i) => i.message),
    ).toEqual(["validation.required", "obligations.errors.expiresBeforeIssue"]);

    const { id: permitId } = await createProjectDocument(team.manager, documentInput(projectId));
    const { id: insuranceId } = await createProjectDocument(
      team.manager,
      documentInput(projectId, {
        kind: "insurance",
        reference: "Police 24-778",
        issuedOn: addDays(today, -355),
        expiresOn: addDays(today, 10),
        issuer: "CAAR",
      }),
    );
    await updateProjectDocument(
      team.manager,
      updateProjectDocumentSchema.parse({
        documentId: permitId,
        kind: "building_permit",
        title: "Permis modificatif",
        reference: "PC 16/0987/2024-M1",
        issuedOn: "2024-09-01",
        expiresOn: "",
        issuer: "APC de Draria",
        notes: "",
      }),
    );
    const { fileId } = await setProjectDocumentScan(team.manager, {
      documentId: permitId,
      upload: pdf(),
    });

    const documents = await listProjectDocuments(team.agentA, projectId);
    expect(documents.map((d) => [d.kind, d.reference, d.scanFileId])).toEqual([
      ["building_permit", "PC 16/0987/2024-M1", fileId],
      ["insurance", "Police 24-778", null],
    ]);
    const [scan] = await withTenant(team.owner, (tx) =>
      tx.select().from(file).where(eq(file.id, fileId)),
    );
    expect(scan).toMatchObject({ entityType: "project_document", entityId: permitId });

    // The insurance expires within 60 days; the project misses its essential documents.
    expect((await getDashboard(team.owner)).todo.documents).toEqual({
      expiring: 1,
      incomplete: 1,
    });
    expect((await getDashboard(team.agentA)).todo.documents).toBeNull();

    await deleteProjectDocument(team.manager, { documentId: insuranceId });
    expect(await listProjectDocuments(team.owner, projectId)).toHaveLength(1);
    const audits = await withTenant(team.owner, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(and(eq(auditLog.entityType, "project"), eq(auditLog.entityId, projectId))),
    );
    expect(audits.map((a) => a.action).sort()).toEqual([
      "project_document.create",
      "project_document.create",
      "project_document.delete",
      "project_document.update",
    ]);
  });

  it("dates the delivery from the contract, shows the indemnity owed and the warranties", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    await updateCompanySettings(
      team.owner,
      companySettingsSchema.parse(
        companySettingsInput({ deliveryPenaltyMonthlyRate: "0,5", fgcmpiNumber: "FG-0482" }),
      ),
    );
    // The project's planned delivery is the contract's date at reservation.
    await withTenant(team.owner, (tx) =>
      tx
        .update(project)
        .set({ plannedDeliveryOn: addDays(today, -30) })
        .where(eq(project.id, setup.projectId)),
    );
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        leadId: "",
      }),
    );
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: addDays(today, -90),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    let sale = await getSale(team.manager, saleId);
    expect(sale?.deliveryDueOn).toBe(addDays(today, -30));
    expect(sale?.obligations).toMatchObject({ daysLate: 30, penalty: 6_505_000n });

    const contract = (overrides: Record<string, string>) =>
      reservationContractSchema.parse({
        reservationId: saleId,
        notary: "Maître Ouali Rym",
        reference: "",
        deliveryDueOn: addDays(today, 10),
        guaranteeNumber: "FGCMPI/GAR/0017",
        guaranteeIssuedOn: addDays(today, -5),
        guaranteePremium: "45 000",
        ...overrides,
      });
    await expect(updateReservationContract(team.agentA, contract({}))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await updateReservationContract(team.manager, contract({}));
    await setReservationScan(team.manager, {
      reservationId: saleId,
      kind: "guarantee",
      upload: pdf(),
    });
    sale = await getSale(team.manager, saleId);
    expect(sale).toMatchObject({
      guaranteeNumber: "FGCMPI/GAR/0017",
      guaranteeIssuedOn: addDays(today, -5),
      guaranteeFileName: "piece.pdf",
      guaranteePremium: 4_500_000n,
      obligations: { daysLate: 0, penalty: 0n, warranties: null },
    });
    const [audit] = await withTenant(team.owner, (tx) =>
      tx
        .select()
        .from(auditLog)
        .where(
          and(eq(auditLog.action, "reservation.update_contract"), eq(auditLog.entityId, saleId)),
        ),
    );
    expect(audit?.before).toMatchObject({
      deliveryDueOn: addDays(today, -30),
      guaranteeNumber: null,
    });

    // Sold and late: the deliveries list and the dashboard flag it.
    await recordSale(
      team.manager,
      recordSaleSchema.parse({
        reservationId: saleId,
        signedOn: addDays(today, -60),
        notary: "Maître Ouali Rym",
        reference: "",
      }),
    );
    await updateReservationContract(team.manager, contract({ deliveryDueOn: addDays(today, -12) }));
    const technical = await addMember(team.orgId, ["technical_manager"]);
    const { items } = await listDeliveries(technical, { state: "all" });
    expect(items.find((i) => i.saleId === saleId)?.daysLate).toBe(12);
    expect((await getDashboard(team.owner)).todo.lateDeliveries).toBe(1);
    expect((await getDashboard(team.agentA)).todo.lateDeliveries).toBeNull();
    const [row] = await withTenant(team.owner, (tx) =>
      tx
        .select({ deliveryDueOn: reservation.deliveryDueOn })
        .from(reservation)
        .where(eq(reservation.id, saleId)),
    );
    expect(row?.deliveryDueOn).toBe(addDays(today, -12));
  });
});
