import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { unit, unitOption, unitStatusHistory } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { TenantCtx } from "@/server/auth/session";
import { companySettingsSchema } from "@/server/organizations/schemas";
import { updateCompanySettings } from "@/server/organizations/settings";

import { addMember, companySettingsInput, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup, newLead } from "../../../tests/sales-fixtures";

import { cancelOption, expireOption, placeOption } from "./options";

const unitStatus = async (ctx: TenantCtx, unitId: string) =>
  (
    await withTenant(ctx, (tx) =>
      tx.select({ s: unit.status }).from(unit).where(eq(unit.id, unitId)),
    )
  )[0]?.s;

describe("options", () => {
  it("hold a unit for the company's duration and schedule their expiry", async () => {
    const team = await createSalesTeam();
    const { unitIds } = await createSaleSetup(team);
    await updateCompanySettings(
      team.owner,
      companySettingsSchema.parse(companySettingsInput({ optionHours: "48" })),
    );
    const leadId = await newLead(team.agentA);
    const before = Date.now();

    const { id, expiresAt } = await placeOption(team.agentA, { unitId: unitIds[0], leadId });

    expect(await unitStatus(team.agentA, unitIds[0])).toBe("optioned");
    const hours = (expiresAt.getTime() - before) / 3_600_000;
    expect(hours).toBeGreaterThan(47.9);
    expect(hours).toBeLessThan(48.1);
    const { rows } = await db.execute<{ start: string }>(
      sql`select start_after as start from pgboss.job where name = 'option.expire' and data->>'optionId' = ${id}`,
    );
    expect(new Date(rows[0]?.start ?? 0).getTime()).toBe(expiresAt.getTime());

    await expect(placeOption(team.manager, { unitId: unitIds[0], leadId })).rejects.toMatchObject({
      code: "CONFLICT",
      messageKey: "sales.errors.unitNotAvailable",
    });
  });

  it("are placed only on visible leads and by sales roles", async () => {
    const team = await createSalesTeam();
    const { unitIds } = await createSaleSetup(team);
    const cashier = await addMember(team.orgId, ["cashier"]);
    const leadId = await newLead(team.agentA);

    await expect(placeOption(team.agentB, { unitId: unitIds[0], leadId })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(placeOption(cashier, { unitId: unitIds[0], leadId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(await unitStatus(team.manager, unitIds[0])).toBe("available");
  });

  it("can be lifted once, which releases the unit", async () => {
    const team = await createSalesTeam();
    const { unitIds } = await createSaleSetup(team);
    const leadId = await newLead(team.agentA);
    const { id } = await placeOption(team.agentA, { unitId: unitIds[1], leadId });

    await cancelOption(team.agentA, { optionId: id, reason: "Le client hésite" });
    expect(await unitStatus(team.agentA, unitIds[1])).toBe("available");
    await expect(cancelOption(team.manager, { optionId: id, reason: null })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("expire through the job only once past their expiry", async () => {
    const team = await createSalesTeam();
    const { unitIds } = await createSaleSetup(team);
    const leadId = await newLead(team.agentA);
    const { id } = await placeOption(team.agentA, { unitId: unitIds[2], leadId });
    const payload = { organizationId: team.orgId, optionId: id };

    expect(await expireOption(payload)).toBe("skipped");
    await withTenant(team.owner, (tx) =>
      tx
        .update(unitOption)
        .set({
          placedAt: new Date(Date.now() - 2 * 86_400_000),
          expiresAt: new Date(Date.now() - 60_000),
        })
        .where(eq(unitOption.id, id)),
    );
    expect(await expireOption(payload)).toBe("expired");
    expect(await expireOption(payload)).toBe("skipped");

    expect(await unitStatus(team.owner, unitIds[2])).toBe("available");
    const [last] = await withTenant(team.owner, (tx) =>
      tx
        .select()
        .from(unitStatusHistory)
        .where(eq(unitStatusHistory.unitId, unitIds[2]))
        .orderBy(sql`${unitStatusHistory.createdAt} desc`)
        .limit(1),
    );
    expect(last).toMatchObject({
      fromStatus: "optioned",
      toStatus: "available",
      actorUserId: null,
      refId: id,
    });
  });
});
