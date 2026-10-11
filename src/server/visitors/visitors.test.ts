import { createECDH, randomBytes, randomUUID } from "node:crypto";

import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { auditLog, portalLink, resident, visitorPass } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { addDays, addMonths, todayInAlgiers } from "@/lib/dates";
import { PASS_CODE_ALPHABET } from "@/lib/visitors";
import type { TenantCtx } from "@/server/auth/session";
import type { PortalCtx } from "@/server/portal/context";
import { applyRetention, savePrivacySettings } from "@/server/privacy/retention";
import { privacySettingsSchema } from "@/server/privacy/schemas";
import { pushSubscriptionSchema } from "@/server/push/schemas";
import { subscribePush } from "@/server/push/service";
import { addResidentSchema, createResidenceSchema } from "@/server/residences/schemas";
import { addResident, createResidence } from "@/server/residences/service";
import { standInUrl } from "@/server/stand-ins";

import { addMember, createSalesTeam } from "../../../tests/factories";
import { createSaleSetup } from "../../../tests/sales-fixtures";

import { announceVisitorSchema, logVisitorSchema } from "./schemas";
import {
  announceVisitor,
  cancelVisitor,
  listPortalVisitors,
  listVisitors,
  logVisitor,
  recordArrival,
} from "./service";

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

const today = todayInAlgiers();

describe("visitors", () => {
  it("lets residents announce visitors with a code and the gate record their arrival", async () => {
    const team = await createSalesTeam();
    const setup = await createSaleSetup(team);
    const manager = await addMember(team.orgId, ["property_manager"]);
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
    await addResident(
      manager,
      addResidentSchema.parse({
        residenceId,
        unitId: setup.unitIds[0],
        kind: "co_owner",
        isMain: true,
        lastName: "Ouali",
        firstName: "Nadia",
        email: "",
        sinceOn: `${today.slice(0, 4)}-01-01`,
      }),
    );
    const [host] = await withTenant(manager, (tx) =>
      tx.select({ id: resident.id }).from(resident).where(eq(resident.lastName, "Ouali")),
    );
    const ouali = await portalAccount(manager, host?.id ?? "");
    const stranger = await addMember(team.orgId, ["resident"]);
    const announce = (who: PortalCtx, expectedOn: string, unitId = setup.unitIds[0]) =>
      announceVisitor(
        who,
        announceVisitorSchema.parse({
          unitId,
          visitorName: "Karim Ouali",
          expectedOn,
          people: "2",
          note: "Mon frère",
        }),
      );

    // A day from today to a month ahead, at one of the account's units.
    await expect(announce(ouali, addDays(today, -1))).rejects.toMatchObject({
      messageKey: "visitors.errors.past",
    });
    await expect(announce(ouali, addDays(today, 40))).rejects.toMatchObject({
      messageKey: "visitors.errors.tooFar",
    });
    await expect(announce(ouali, today, setup.unitIds[1])).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      announce({ userId: stranger.userId, orgId: team.orgId, name: "X", locale: "fr" }, today),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const visit = await announce(ouali, today);
    expect(visit.code).toMatch(new RegExp(`^[${PASS_CODE_ALPHABET}]{4}$`));
    const tomorrow = await announce(ouali, addDays(today, 1));
    expect((await listPortalVisitors(ouali)).passes.map((p) => p.status)).toEqual([
      "expected",
      "expected",
    ]);

    // The register: the gérant and the gestionnaire, or a guard's custom role; never a commercial.
    await expect(listVisitors(team.agentA, residenceId, { day: today })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    const guard: TenantCtx = {
      ...(await addMember(team.orgId, ["cashier"])),
      permissions: ["visitor:read", "visitor:update"],
    };
    const register = await listVisitors(guard, residenceId, { day: today });
    expect(register.passes).toEqual([
      expect.objectContaining({ visitorName: "Karim Ouali", people: 2, hostName: "Ouali Nadia" }),
    ]);
    expect(
      (await listVisitors(guard, residenceId, { day: today, code: visit.code.toLowerCase() }))
        .passes,
    ).toHaveLength(1);
    expect(
      (await listVisitors(guard, residenceId, { day: today, code: "ZZZZ" })).passes,
    ).toHaveLength(0);

    // The host's phone hears of the arrival.
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    await subscribePush(
      ouali,
      pushSubscriptionSchema.parse({
        endpoint: `${standInUrl("push")}/dev-${randomUUID()}`,
        keys: {
          p256dh: ecdh.getPublicKey().toString("base64url"),
          auth: randomBytes(16).toString("base64url"),
        },
        locale: "fr",
      }),
    );
    await expect(recordArrival(guard, { passId: tomorrow.id })).rejects.toMatchObject({
      messageKey: "visitors.errors.notToday",
    });
    await recordArrival(guard, { passId: visit.id });
    await expect(recordArrival(guard, { passId: visit.id })).rejects.toMatchObject({
      messageKey: "visitors.errors.notExpected",
    });
    const { rows } = await db.execute<{ kind: string; visitor: string }>(sql`
      select data->>'kind' as kind, data->'params'->>'visitor' as visitor from pgboss.job
      where name = 'push.send' and data->>'organizationId' = ${team.orgId}
    `);
    expect(rows).toEqual([{ kind: "visitor_arrived", visitor: "Karim Ouali" }]);
    expect((await listPortalVisitors(ouali)).passes.find((p) => p.id === visit.id)).toMatchObject({
      status: "arrived",
      arrivedAt: expect.any(Date),
    });

    // An unannounced visitor, at a unit of the residence or for the common areas.
    const walkIn = (unitId: string) =>
      logVisitorSchema.parse({
        residenceId,
        unitId,
        hostName: "Gardien",
        visitorName: "Plombier de la société Eau Pure",
        people: "",
        note: "Fuite au 2e étage",
      });
    await expect(logVisitor(team.agentA, walkIn(""))).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(logVisitor(manager, walkIn(randomUUID()))).rejects.toMatchObject({
      messageKey: "visitors.errors.unit",
    });
    await logVisitor(manager, walkIn(""));
    expect(
      (await listVisitors(manager, residenceId, { day: today })).passes.map((p) => p.status),
    ).toEqual(["arrived", "arrived"]);

    // A resident cancels its own visitor, never another's.
    await cancelVisitor(ouali, { passId: tomorrow.id });
    await expect(cancelVisitor(ouali, { passId: tomorrow.id })).rejects.toMatchObject({
      messageKey: "visitors.errors.notExpected",
    });

    // The register is kept; the names are erased after the retention period.
    await expect(
      withTenant(manager, (tx) => tx.delete(visitorPass).where(eq(visitorPass.id, visit.id))),
    ).rejects.toThrow();
    await savePrivacySettings(
      team.owner,
      privacySettingsSchema.parse({ visitorRetentionMonths: "12" }),
    );
    expect((await applyRetention(team.orgId, addMonths(today, 11))).visitors).toBe(0);
    expect((await applyRetention(team.orgId, addMonths(today, 13))).visitors).toBe(3);
    const erased = await withTenant(manager, (tx) =>
      tx.select({ name: visitorPass.visitorName, note: visitorPass.note }).from(visitorPass),
    );
    expect(erased.every((v) => v.name === "—" && v.note === null)).toBe(true);

    const audits = await withTenant(manager, (tx) => tx.select().from(auditLog));
    const visitorAudits = audits.filter((a) => a.action.startsWith("visitor."));
    expect(visitorAudits.map((a) => a.action).sort()).toEqual(["visitor.arrival", "visitor.log"]);
    // The audit never keeps the visitor's name.
    expect(JSON.stringify(visitorAudits)).not.toContain("Karim");
  });
});
