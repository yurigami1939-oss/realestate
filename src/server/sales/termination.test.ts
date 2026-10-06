import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { reminderLetter, reservation, unit, withdrawal } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { issueReminderSchema } from "@/server/collections/schemas";
import { issueReminderLetter } from "@/server/collections/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { createReservation, recordSale } from "./reservations";
import {
  createReservationSchema,
  decideWithdrawalSchema,
  proposeWithdrawalSchema,
  recordSaleSchema,
} from "./schemas";
import { decideWithdrawal, listSaleWithdrawals, proposeWithdrawal } from "./withdrawals";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("termination for non-payment", () => {
  it("needs formal notices left without effect, then the gérant terminates a sold sale", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        leadId: "",
      }),
    );
    // Signed 40 days ago, the signing installment never paid; the VSP signed since.
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: addDays(today, -40),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    await recordSale(
      team.manager,
      recordSaleSchema.parse({
        reservationId: saleId,
        signedOn: addDays(today, -30),
        notary: "Me Benali",
        reference: "",
      }),
    );

    // Formal notices: managers only, never shorter than the company's delay (15 days).
    const notice = (payBy: string) =>
      issueReminderSchema.parse({ reservationId: saleId, payBy, kind: "formal_notice" });
    await expect(issueReminderLetter(cashier, notice(addDays(today, 15)))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      issueReminderLetter(team.manager, notice(addDays(today, 10))),
    ).rejects.toMatchObject({ messageKey: "collections.errors.noticeTooShort" });
    await issueReminderLetter(team.manager, notice(addDays(today, 15)));

    const terminate = () =>
      proposeWithdrawal(
        team.manager,
        proposeWithdrawalSchema.parse({
          reservationId: saleId,
          retention: "10",
          reason: "Deux mises en demeure restées sans effet",
          kind: "termination",
        }),
      );
    // The notice issued today has not expired yet.
    await expect(terminate()).rejects.toMatchObject({ messageKey: "sales.errors.noticesMissing" });

    // Two earlier notices whose delay is over (as if issued weeks ago).
    await withTenant(team.owner, async (tx) => {
      for (const payBy of [addDays(today, -20), addDays(today, -2)]) {
        await tx.insert(reminderLetter).values({
          organizationId: team.orgId,
          reservationId: saleId,
          kind: "formal_notice",
          issuedBy: team.manager.userId,
          overdue: 260_200_000n,
          penalties: 0n,
          lines: [],
          payBy,
        });
      }
    });
    await terminate();
    await expect(terminate()).rejects.toMatchObject({ code: "CONFLICT" });
    const [proposal] = await listSaleWithdrawals(team.manager, saleId);
    expect(proposal).toMatchObject({ kind: "termination", status: "proposed", paid: 0n });

    await decideWithdrawal(
      team.owner,
      decideWithdrawalSchema.parse({ withdrawalId: proposal?.id, approve: true, note: "" }),
    );
    const [after] = await withTenant(team.owner, (tx) =>
      tx
        .select({ status: reservation.status, unitStatus: unit.status, kind: withdrawal.kind })
        .from(reservation)
        .innerJoin(unit, eq(unit.id, reservation.unitId))
        .innerJoin(withdrawal, eq(withdrawal.reservationId, reservation.id))
        .where(eq(reservation.id, saleId)),
    );
    expect(after).toEqual({ status: "withdrawn", unitStatus: "available", kind: "termination" });
  });

  it("keeps the withdrawal (désistement) for reservations before the VSP", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({
        lastName: "Kaci",
        firstName: "Amina",
        phone: "0770 98 76 54",
        leadId: "",
      }),
    );
    const { id: saleId } = await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[1],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: today,
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    // Nothing overdue: no termination, but a désistement can be proposed.
    await expect(
      proposeWithdrawal(
        team.manager,
        proposeWithdrawalSchema.parse({
          reservationId: saleId,
          retention: "10",
          reason: "Résiliation demandée",
          kind: "termination",
        }),
      ),
    ).rejects.toMatchObject({ messageKey: "sales.errors.notOverdue" });
    await proposeWithdrawal(
      team.manager,
      proposeWithdrawalSchema.parse({ reservationId: saleId, retention: "10", reason: "Mutation" }),
    );
  });
});
