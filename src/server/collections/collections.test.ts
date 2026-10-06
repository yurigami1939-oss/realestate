import { eq, inArray, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { reminderLetter, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { companySettingsSchema } from "@/server/organizations/schemas";
import { updateCompanySettings } from "@/server/organizations/settings";
import { recordPaymentSchema } from "@/server/payments/schemas";
import { recordPayment } from "@/server/payments/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";

import { addMember, companySettingsInput, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { reminderLetterHtml, renderAndStoreReminderLetter } from "./documents";
import { listOverdueSales, listSaleReminders } from "./queries";
import { issueReminderSchema } from "./schemas";
import { issueReminderLetter, queueOverdueDigests, sendOverdueDigest } from "./service";

const today = todayInAlgiers();

async function sale(ctx: TenantCtx, unitId: string, planId: string, nin: string, on: string) {
  const phone = `0550 01 ${nin.slice(-4, -2)} ${nin.slice(-2)}`;
  const leadId = await newLead(ctx, phone);
  const { id: buyerId } = await createBuyer(
    ctx,
    createBuyerSchema.parse({ lastName: "Mansouri", firstName: "Lyes", nin, phone, leadId }),
  );
  const { id, number } = await createReservation(
    ctx,
    createReservationSchema.parse({
      unitId,
      buyerIds: [buyerId],
      paymentPlanId: planId,
      discount: "",
      reservedOn: on,
      notary: "",
      reference: "",
      notes: "",
    }),
  );
  return { id, number };
}

/** Three sales of agent A: 60 days late, partly paid 10 days late, signed today. */
async function scenario() {
  const team = await createSalesTeam();
  const { unitIds, planId } = await createSaleSetup(team);
  const cashier = await addMember(team.orgId, ["cashier"]);
  await updateCompanySettings(
    team.owner,
    companySettingsSchema.parse(companySettingsInput({ penaltyMonthlyRate: "1,5" })),
  );
  const late = await sale(
    team.agentA,
    unitIds[0],
    planId,
    "109085198500200001",
    addDays(today, -60),
  );
  const partly = await sale(
    team.agentA,
    unitIds[1],
    planId,
    "109085198500200002",
    addDays(today, -10),
  );
  const fresh = await sale(team.agentA, unitIds[2], planId, "109085198500200003", today);
  await recordPayment(
    cashier,
    recordPaymentSchema.parse({
      reservationId: partly.id,
      amount: "602 000",
      method: "cash",
      paidOn: today,
      payerName: "Lyes Mansouri",
    }),
  );
  return { team, cashier, late, partly, fresh };
}

describe("overdue installments", () => {
  it("are listed most late first, with computed penalties, for members who see the sales", async () => {
    const { team, late, partly } = await scenario();

    const list = await listOverdueSales(team.manager, {});
    expect(list.rows.map((r) => [r.number, r.overdue, r.daysLate])).toEqual([
      [late.number, 260_200_000n, 60],
      [partly.number, 200_000_000n, 10],
    ]);
    // 1,5 % a month: 2 602 000 DA × 1,5 % × 60 / 30 = 78 060 DA (shown, never charged).
    expect(list.rows[0]?.penalties).toBe(7_806_000n);
    expect(list.overdue).toBe(460_200_000n);
    expect(list.rows[0]).toMatchObject({
      buyers: "Mansouri Lyes",
      oldestDueOn: addDays(today, -60),
    });
    expect((await listOverdueSales(team.agentA, {})).total).toBe(2);
    expect((await listOverdueSales(team.agentB, {})).total).toBe(0);
  });
});

describe("reminder letters", () => {
  it("snapshot the overdue lines and render a bilingual PDF once", async () => {
    const { team, cashier, late, fresh } = await scenario();
    const input = issueReminderSchema.parse({ reservationId: late.id, payBy: addDays(today, 8) });

    await expect(issueReminderLetter(team.agentA, input)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(
      issueReminderLetter(cashier, {
        reservationId: fresh.id,
        payBy: addDays(today, 8),
        kind: "reminder",
      }),
    ).rejects.toMatchObject({ messageKey: "collections.errors.nothingOverdue" });
    await expect(
      issueReminderLetter(cashier, { ...input, payBy: addDays(today, -1) }),
    ).rejects.toMatchObject({ messageKey: "collections.errors.payByPast" });

    const { id, overdue } = await issueReminderLetter(cashier, input);
    expect(overdue).toBe(260_200_000n);
    const [letter] = await withTenant(cashier, (tx) =>
      tx.select().from(reminderLetter).where(eq(reminderLetter.id, id)),
    );
    expect(letter).toMatchObject({ penalties: 7_806_000n, payBy: addDays(today, 8) });
    expect(letter?.lines).toEqual([
      {
        position: 1,
        label: "Réservation",
        dueOn: addDays(today, -60),
        remaining: "260200000",
        daysLate: 60,
        penalty: "7806000",
      },
    ]);
    const { rows } = await db.execute<{ n: number }>(
      sql`select count(*)::int as n from pgboss.job
          where name = 'pdf.document' and data->>'id' = ${id}`,
    );
    expect(rows[0]?.n).toBe(1);

    expect(await renderAndStoreReminderLetter(team.orgId, id)).toBe("stored");
    expect(await renderAndStoreReminderLetter(team.orgId, id)).toBe("skipped");
    const reminders = await listSaleReminders(team.agentA, late.id);
    expect(reminders).toEqual([
      expect.objectContaining({ id, overdue: 260_200_000n, pdfFileId: expect.any(String) }),
    ]);
    const list = await listOverdueSales(team.manager, {});
    expect(list.rows[0]?.lastReminderAt).toBeInstanceOf(Date);

    // Letters are kept as printed.
    await expect(
      withTenant(team.owner, (tx) =>
        tx.update(reminderLetter).set({ overdue: 1n }).where(eq(reminderLetter.id, id)),
      ),
    ).rejects.toThrow();

    const html = reminderLetterHtml(
      {
        kind: "reminder",
        noticeNumber: null,
        issuedAt: new Date("2026-10-01T09:00:00Z"),
        saleNumber: "RES-2026-000001",
        saleDeedNumber: null,
        projectName: "Résidence Les Oliviers",
        unitCode: "A-03-01",
        payBy: "2026-10-09",
        overdue: 260_200_000n,
        penalties: 7_806_000n,
        lines: [
          {
            label: "Réservation",
            dueOn: "2026-08-02",
            remaining: 260_200_000n,
            daysLate: 60,
            penalty: 7_806_000n,
          },
        ],
        buyers: [{ name: "Mansouri Lyes", nameAr: "منصوري لياس", address: "" }],
      },
      {
        name: "Promo",
        legalName: "SARL Promo",
        address: null,
        wilaya: null,
        phone: null,
        rcNumber: null,
        nif: null,
        nis: null,
        aiNumber: null,
      },
    );
    expect(html).toContain("LETTRE DE RELANCE");
    expect(html).toContain('<bdi dir="rtl" lang="ar">منصوري لياس</bdi>');
    expect(html).toContain("09/10/2026");
    expect(html).toContain("deux millions six cent deux mille dinars");
  });
});

describe("overdue digest", () => {
  it("e-mails the overdue sales to cashiers and sales managers once a day", async () => {
    const { team, cashier, late } = await scenario();
    const expected = (
      await db
        .select({ email: user.email })
        .from(user)
        .where(inArray(user.id, [team.manager.userId, cashier.userId]))
    ).map((u) => u.email);
    const emails = async () =>
      (
        await db.execute<{ to: string; subject: string; html: string }>(
          sql`select data->>'to' as to, data->>'subject' as subject, data->>'html' as html
              from pgboss.job where name = 'email.send'
              and singleton_key like ${`digest:${team.orgId}:%`}`,
        )
      ).rows;

    expect(await sendOverdueDigest(team.orgId, today)).toBe(2);
    const sent = await emails();
    expect(sent.map((e) => e.to).sort()).toEqual(expected.sort());
    expect(sent[0]?.subject).toContain("Échéances impayées");
    expect(sent[0]?.html).toContain(late.number);

    await sendOverdueDigest(team.orgId, today);
    expect(await emails()).toHaveLength(2);
  });

  it("is queued once a day for every organization by the 08:00 job", async () => {
    const { orgId } = await createSalesTeam();
    const digests = async () =>
      (
        await db.execute<{ n: number }>(
          sql`select count(*)::int as n from pgboss.job
              where name = 'reminders.digest' and data->>'organizationId' = ${orgId}`,
        )
      ).rows[0]?.n;

    expect(await queueOverdueDigests()).toBeGreaterThanOrEqual(1);
    await queueOverdueDigests();
    expect(await digests()).toBe(1);
    // One job per organization of the test database, which grows with every run.
  }, 180_000);
});
