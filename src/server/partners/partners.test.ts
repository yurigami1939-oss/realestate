import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { partnerCommission } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { createLead } from "@/server/crm/leads";
import { createLeadSchema } from "@/server/crm/schemas";
import { createReservation, recordSale } from "@/server/sales/reservations";
import { createReservationSchema, recordSaleSchema } from "@/server/sales/schemas";
import { getAccountLedger } from "@/server/treasury/queries";
import { createAccountSchema } from "@/server/treasury/schemas";
import { createAccount } from "@/server/treasury/service";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { createPartnerSchema, payPartnerCommissionSchema } from "./schemas";
import {
  createPartner,
  listPartnerCommissions,
  listPartners,
  payPartnerCommission,
} from "./service";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("partners", () => {
  it("earns the agency's commission at the VSP and pays it from the bank", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const accountant = await addMember(team.orgId, ["accountant"]);
    const partnerInput = createPartnerSchema.parse({
      kind: "agency",
      name: "Agence El Bahia",
      contactName: "",
      phone: "0550 98 76 54",
      email: "",
      nif: "",
      rcNumber: "",
      commissionRate: "1,5",
      notes: "",
    });
    await expect(createPartner(team.agentA, partnerInput)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const { id: partnerId } = await createPartner(team.manager, partnerInput);

    // The commercial records a lead the agency brought.
    const { id: leadId } = await createLead(
      team.agentA,
      createLeadSchema.parse({
        fullName: "Karim Bensalem",
        phone: "0550 12 34 56",
        source: "referral",
        typologies: [],
        partnerId,
      }),
    );
    const { id: buyerId } = await createBuyer(
      team.agentA,
      createBuyerSchema.parse({
        lastName: "Bensalem",
        firstName: "Karim",
        phone: "0550 12 34 56",
        leadId,
      }),
    );
    const { id: saleId } = await createReservation(
      team.agentA,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: addDays(today, -10),
        notary: "",
        reference: "",
        notes: "",
      }),
    );
    await recordSale(
      team.manager,
      recordSaleSchema.parse({
        reservationId: saleId,
        signedOn: today,
        notary: "Me Hamidi",
        reference: "",
      }),
    );

    // 1,5 % of 13 010 000 DA.
    const [earned] = await listPartnerCommissions(accountant);
    expect(earned).toMatchObject({
      partnerName: "Agence El Bahia",
      amount: 19_515_000n,
      rateBp: 150,
      status: "earned",
    });
    expect((await listPartners(team.manager))[0]).toMatchObject({ leads: 1, earned: 19_515_000n });

    const { id: bankId } = await createAccount(
      team.owner,
      createAccountSchema.parse({
        kind: "bank",
        name: "BNA",
        bankName: "BNA",
        accountNumber: "",
        isDefault: true,
        notes: "",
        openingBalance: "1 000 000",
        openingOn: addDays(today, -30),
      }),
    );
    const pay = payPartnerCommissionSchema.parse({
      commissionId: earned?.id,
      paidOn: today,
      method: "bank_transfer",
      accountId: "",
    });
    await expect(payPartnerCommission(team.agentA, pay)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await payPartnerCommission(accountant, pay);
    await expect(payPartnerCommission(accountant, pay)).rejects.toMatchObject({
      messageKey: "commissions.errors.notEarned",
    });
    const ledger = await getAccountLedger(team.owner, bankId, { from: today, to: today });
    expect(ledger?.lines.map((l) => [l.source, l.amountOut])).toEqual([
      ["partner_commission", 19_515_000n],
    ]);
    const [row] = await withTenant(team.owner, (tx) =>
      tx
        .select({ status: partnerCommission.status, accountId: partnerCommission.accountId })
        .from(partnerCommission)
        .where(eq(partnerCommission.reservationId, saleId)),
    );
    expect(row).toEqual({ status: "paid", accountId: bankId });
  });
});
