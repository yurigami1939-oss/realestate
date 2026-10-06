import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { member } from "@/db/schema";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import type { TenantCtx } from "@/server/auth/session";
import { createBuyerSchema } from "@/server/buyers/schemas";
import { createBuyer } from "@/server/buyers/service";
import { createReservation } from "@/server/sales/reservations";
import { createReservationSchema } from "@/server/sales/schemas";
import { createAccountSchema } from "@/server/treasury/schemas";
import { createAccount } from "@/server/treasury/service";

import { addMember, createOrganization, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { getGroupOverview } from "./queries";

afterAll(async () => {
  await stopEnqueue();
});

const today = todayInAlgiers();

describe("group overview", () => {
  it("shows a gérant's companies side by side, each read in its own tenant", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const { id: buyerId } = await createBuyer(
      team.manager,
      createBuyerSchema.parse({ lastName: "Bensalem", firstName: "Karim", phone: "0550 12 34 56" }),
    );
    await createReservation(
      team.manager,
      createReservationSchema.parse({
        unitId: setup.unitIds[0],
        buyerIds: [buyerId],
        paymentPlanId: setup.planId,
        discount: "",
        reservedOn: today,
        notary: "",
        reference: "",
        notes: "",
      }),
    );

    // One company only: no group view.
    expect(await getGroupOverview(team.owner)).toBeNull();

    // The same gérant runs a second company, with cash on a bank account.
    const second = await createOrganization({ name: "SARL Les Pins" });
    await db.insert(member).values({
      organizationId: second.id,
      userId: team.owner.userId,
      role: "owner",
      createdAt: new Date(),
    });
    const owner2: TenantCtx = { ...team.owner, orgId: second.id };
    await createAccount(
      owner2,
      createAccountSchema.parse({
        kind: "bank",
        name: "CPA",
        bankName: "CPA",
        accountNumber: "",
        isDefault: true,
        notes: "",
        openingBalance: "2 500 000",
        openingOn: addDays(today, -30),
      }),
    );
    // A company where they are only a commercial is not part of their group.
    await db.insert(member).values({
      organizationId: (await createOrganization()).id,
      userId: team.owner.userId,
      role: "sales_agent",
      createdAt: new Date(),
    });

    const overview = await getGroupOverview(team.owner);
    expect(overview?.companies.map((c) => [c.active, c.reservations, c.cash])).toEqual([
      [true, 1, 0n],
      [false, 0, 250_000_000n],
    ]);
    expect(overview?.companies[0]).toMatchObject({ reserved: 1_301_000_000n, available: 2 });
    expect(overview?.total).toMatchObject({ reservations: 1, cash: 250_000_000n, available: 2 });
    // The manager of the first company runs nothing else.
    expect(await getGroupOverview(team.manager)).toBeNull();
    expect(await getGroupOverview(await addMember(second.id, ["owner"]))).toBeNull();
  });
});
