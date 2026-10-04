import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { ticketEvent } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createResidenceSchema } from "@/server/residences/schemas";
import { createResidence } from "@/server/residences/service";
import { createStaffSchema } from "@/server/staff/schemas";
import { createStaff } from "@/server/staff/service";
import { createSupplierSchema } from "@/server/suppliers/schemas";
import { createSupplier } from "@/server/suppliers/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getTicket, listTickets, listTicketTargets } from "./queries";
import {
  assignTicketSchema,
  changeTicketStatusSchema,
  commentTicketSchema,
  createTicketSchema,
} from "./schemas";
import { assignTicket, changeTicketStatus, commentTicket, createTicket } from "./service";

async function scenario() {
  const team = await createSalesTeam();
  const { projectId, unitIds } = await createSaleSetup(team);
  const manager = await addMember(team.orgId, ["property_manager"]);
  const { id: residenceId } = await createResidence(
    manager,
    createResidenceSchema.parse({
      projectId,
      name: "Résidence Les Oliviers",
      shareBasis: "10000",
      chargeFrequency: "quarterly",
      reserveFund: "0",
      callDueDays: "30",
    }),
  );
  const { id: staffId } = await createStaff(
    manager,
    createStaffSchema.parse({
      residenceId,
      role: "maintenance",
      lastName: "Kaci",
      firstName: "Omar",
      hiredOn: "2026-01-01",
      monthlySalary: "40 000",
      categoryId: "",
    }),
  );
  return { team, manager, residenceId, unitIds, staffId };
}

const ticketInput = (residenceId: string, overrides: Record<string, string> = {}) =>
  createTicketSchema.parse({
    residenceId,
    unitId: "",
    reporterName: "Saïdi Yasmine",
    title: "Fuite d'eau au 3e étage",
    description: "Le plafond du palier goutte.",
    category: "plumbing",
    priority: "high",
    ...overrides,
  });

describe("tickets", () => {
  it("follow their workflow, are assigned and keep their history", async () => {
    const { team, manager, residenceId, unitIds, staffId } = await scenario();
    const cashier = await addMember(team.orgId, ["cashier"]);
    const other = await scenario();

    await expect(createTicket(cashier, ticketInput(residenceId))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      createTicket(manager, ticketInput(residenceId, { unitId: other.unitIds[0] })),
    ).rejects.toMatchObject({ messageKey: "residences.errors.unitNotInResidence" });
    const { id } = await createTicket(manager, ticketInput(residenceId, { unitId: unitIds[0] }));
    const { id: urgent } = await createTicket(
      team.owner,
      ticketInput(residenceId, {
        title: "Ascenseur bloqué",
        category: "elevator",
        priority: "urgent",
      }),
    );

    const status = (to: string, comment = "") =>
      changeTicketStatusSchema.parse({ ticketId: id, status: to, comment });
    await changeTicketStatus(manager, status("in_progress"));
    await expect(changeTicketStatus(manager, status("closed"))).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    await changeTicketStatus(manager, status("resolved", "Joint remplacé"));
    expect((await getTicket(manager, id))?.resolvedAt).not.toBeNull();
    // Reopened, then solved for good.
    await changeTicketStatus(manager, status("in_progress", "La fuite reprend"));
    expect((await getTicket(manager, id))?.resolvedAt).toBeNull();

    const assign = (staff: string, supplier: string) =>
      assignTicketSchema.parse({ ticketId: id, staffId: staff, supplierId: supplier });
    expect(() => assign(staffId, staffId)).toThrow();
    await expect(assignTicket(manager, assign(other.staffId, ""))).rejects.toMatchObject({
      messageKey: "tickets.errors.assigneeNotFound",
    });
    await assignTicket(manager, assign(staffId, ""));
    const { id: plumber } = await createSupplier(
      manager,
      createSupplierSchema.parse({ name: "Plomberie Benali" }),
    );
    await assignTicket(manager, assign("", plumber));
    await commentTicket(
      manager,
      commentTicketSchema.parse({ ticketId: id, comment: "Intervention jeudi" }),
    );
    await changeTicketStatus(manager, status("resolved"));
    await changeTicketStatus(manager, status("closed"));
    await expect(changeTicketStatus(manager, status("open"))).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    await expect(assignTicket(manager, assign(staffId, ""))).rejects.toMatchObject({
      messageKey: "tickets.errors.ticketClosed",
    });

    const sheet = await getTicket(manager, id);
    expect(sheet).toMatchObject({ status: "closed", assignee: "Plomberie Benali" });
    expect(sheet?.closedAt).not.toBeNull();
    expect(sheet?.events.map((e) => [e.kind, e.toStatus, e.assignee])).toEqual([
      ["created", "open", null],
      ["status", "in_progress", null],
      ["status", "resolved", null],
      ["status", "in_progress", null],
      ["assigned", null, "Kaci Omar"],
      ["assigned", null, "Plomberie Benali"],
      ["comment", null, null],
      ["status", "resolved", null],
      ["status", "closed", null],
    ]);
    // The history is append-only.
    await expect(
      withTenant(team.owner, (tx) =>
        tx.update(ticketEvent).set({ comment: "x" }).where(eq(ticketEvent.ticketId, id)),
      ),
    ).rejects.toThrow();

    expect(
      (await listTickets(manager, { residenceId, status: "active" })).map((t) => t.id),
    ).toEqual([urgent]);
    expect((await listTickets(manager, { residenceId })).map((t) => [t.title, t.priority])).toEqual(
      [
        ["Ascenseur bloqué", "urgent"],
        ["Fuite d'eau au 3e étage", "high"],
      ],
    );
    expect((await listTicketTargets(manager)).map((r) => r.units.length)).toEqual([3]);
  });
});
