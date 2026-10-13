import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { db } from "@/db/client";
import { consoleDb } from "@/db/console-client";
import { auditLog, consoleAuditLog, dataAccess, member, session, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { auth } from "@/server/auth/auth";
import { OPERATOR_ROLE } from "@/server/auth/schema-options";
import type { TenantCtx } from "@/server/auth/session";
import { assertWritable, loadTenantAccess, supportAccess } from "@/server/entitlements/access";
import { getFileDownloadUrl } from "@/server/files/service";
import { getGroupOverview } from "@/server/group/queries";
import { setUnitFloorPlan } from "@/server/inventory/floor-plans";
import {
  createBuildingSchema,
  createProjectSchema,
  createUnitSchema,
} from "@/server/inventory/schemas";
import { createBuilding, createProject, createUnit } from "@/server/inventory/service";
import { recordAccess } from "@/server/privacy/consents";

import { createOrganizationAs, signIn, signUp } from "../../../tests/auth-helpers";
import { openTestAccount } from "../../../tests/console-fixtures";
import { createUser } from "../../../tests/factories";

import { listSupportMembers, startSupportSession, stopSupportSession } from "./support";
import { pendingSupportOrganization } from "./support-sessions";

/** The cookies a browser keeps from these responses (later ones replace earlier ones). */
function browserCookies(...responses: Headers[]): Headers {
  const jar = new Map<string, string>();
  for (const headers of responses) {
    for (const cookie of headers.getSetCookie()) {
      const [pair = ""] = cookie.split(";");
      const name = pair.slice(0, pair.indexOf("="));
      if (/max-age=0/i.test(cookie)) jar.delete(name);
      else jar.set(name, pair);
    }
  }
  return new Headers({ cookie: [...jar.values()].join("; ") });
}

/** A gérant of two SARLs on one account, an operator, and the operator's ctx and headers. */
async function scenario() {
  const gerant = await signUp("Gerant");
  const first = await createOrganizationAs(gerant.headers);
  const second = await createOrganizationAs(gerant.headers);
  await openTestAccount([first.id, second.id]);
  const op = await signUp("Operatrice");
  await db.update(user).set({ role: OPERATOR_ROLE }).where(eq(user.id, op.userId));
  const opHeaders = await signIn(op.email);
  return {
    gerant,
    first,
    second,
    operator: { userId: op.userId, name: "Opératrice Sayroura", headers: opHeaders },
  };
}
/** The support session's cookies without Better Auth's admin cookie (dropped by the browser). */
const withoutAdminCookie = (headers: Headers) =>
  (headers.get("cookie") ?? "")
    .split("; ")
    .filter((c) => !c.includes("admin_session"))
    .join("; ");

const tenantAudit = (orgId: string, action: string) =>
  withTenant({ orgId }, (tx) =>
    tx
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, orgId), eq(auditLog.action, action))),
  );

describe("support sessions (CLAUDE.console.md §12)", () => {
  it("offers the organization's staff only, the gérant first", async () => {
    const { gerant, second } = await scenario();
    const [cashier, resident] = await Promise.all([
      createUser({ name: "Amel Caissière" }),
      createUser({ name: "Mohamed Résident" }),
    ]);
    await db.insert(member).values([
      { organizationId: second.id, userId: cashier.id, role: "cashier", createdAt: new Date() },
      { organizationId: second.id, userId: resident.id, role: "resident", createdAt: new Date() },
    ]);
    const members = await listSupportMembers([second.id]);
    expect(members.map((m) => m.userId)).toEqual([gerant.userId, cashier.id]);
  });

  it("records the reason in both trails, then opens the member's session on that organization", async () => {
    const { gerant, second, operator } = await scenario();
    const resident = await createUser();
    await db.insert(member).values({
      organizationId: second.id,
      userId: resident.id,
      role: "resident",
      createdAt: new Date(),
    });
    const start = (userId: string) =>
      startSupportSession(
        operator,
        { organizationId: second.id, userId, reason: "Ticket 42 : reçus en double" },
        operator.headers,
      );
    // Never a portal account, never a stranger.
    await expect(start(resident.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      messageKey: "console.errors.supportMember",
    });
    await expect(start((await createUser()).id)).rejects.toMatchObject({ code: "NOT_FOUND" });

    const { headers } = await start(gerant.userId);
    const [trail] = await consoleDb
      .select()
      .from(consoleAuditLog)
      .where(
        and(
          eq(consoleAuditLog.action, "support.start"),
          eq(consoleAuditLog.organizationId, second.id),
        ),
      );
    expect(trail).toMatchObject({
      actorUserId: operator.userId,
      reason: "Ticket 42 : reçus en double",
      after: { userId: gerant.userId },
    });
    const [access] = await tenantAudit(second.id, "support.access");
    expect(access).toMatchObject({
      actorUserId: operator.userId,
      reason: "Ticket 42 : reçus en double",
      after: { operator: "Opératrice Sayroura" },
    });

    // The member's session, on the organization chosen (not the gérant's first one), 60 minutes.
    const [opened] = await db
      .select()
      .from(session)
      .where(and(eq(session.userId, gerant.userId), eq(session.impersonatedBy, operator.userId)));
    expect(opened?.activeOrganizationId).toBe(second.id);
    const minutes = ((opened?.expiresAt.getTime() ?? 0) - Date.now()) / 60_000;
    expect(Math.round(minutes)).toBe(60);

    // Better Auth refuses a member's change and an organization switch during it (requests).
    const support = browserCookies(operator.headers, headers);
    const switched = await auth.handler(
      new Request("http://localhost:3000/api/auth/organization/set-active", {
        method: "POST",
        headers: {
          cookie: support.get("cookie") ?? "",
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ organizationId: second.id }),
      }),
    );
    expect(switched.status).toBe(403);
    expect(await switched.json()).toMatchObject({ code: "SUPPORT_READ_ONLY" });
    // Dropping the admin cookie changes nothing: the session itself is the support session.
    const switchedAgain = await auth.handler(
      new Request("http://localhost:3000/api/auth/organization/set-active", {
        method: "POST",
        headers: {
          cookie: withoutAdminCookie(support),
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ organizationId: second.id }),
      }),
    );
    expect(switchedAgain.status).toBe(403);
    expect(await switchedAgain.json()).toMatchObject({ code: "SUPPORT_READ_ONLY" });

    // Ending it: both trails, the member's session gone, the operator's back.
    expect(await stopSupportSession(support)).toEqual({ restored: true });
    expect(await tenantAudit(second.id, "support.end")).toHaveLength(1);
    const stops = await consoleDb
      .select({ id: consoleAuditLog.id })
      .from(consoleAuditLog)
      .where(
        and(
          eq(consoleAuditLog.action, "support.stop"),
          eq(consoleAuditLog.organizationId, second.id),
        ),
      );
    expect(stops).toHaveLength(1);
    expect(
      await db
        .select()
        .from(session)
        .where(eq(session.id, opened?.id ?? "")),
    ).toEqual([]);
    // Outside a support session there is nothing to end.
    await expect(stopSupportSession(operator.headers)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("ends a support session whose admin cookie was dropped: recorded, the member's session gone", async () => {
    const { gerant, first, operator } = await scenario();
    const { headers } = await startSupportSession(
      operator,
      { organizationId: first.id, userId: gerant.userId, reason: "Appel du gérant" },
      operator.headers,
    );
    const support = new Headers({
      cookie: withoutAdminCookie(browserCookies(operator.headers, headers)),
    });
    expect(await stopSupportSession(support)).toEqual({ restored: false });
    expect(await tenantAudit(first.id, "support.end")).toHaveLength(1);
    expect(
      await db
        .select({ id: session.id })
        .from(session)
        .where(and(eq(session.userId, gerant.userId), eq(session.impersonatedBy, operator.userId))),
    ).toEqual([]);
  });

  it("opens no organization for an impersonation nobody recorded a reason for", async () => {
    const { gerant, operator } = await scenario();
    expect(await pendingSupportOrganization(operator.userId, gerant.userId)).toBeNull();
    await auth.api.impersonateUser({ body: { userId: gerant.userId }, headers: operator.headers });
    const [opened] = await db
      .select({ activeOrganizationId: session.activeOrganizationId })
      .from(session)
      .where(and(eq(session.userId, gerant.userId), eq(session.impersonatedBy, operator.userId)));
    expect(opened).toEqual({ activeOrganizationId: null });
    // Asked by a browser (two-factor on), it is refused outright.
    await db.update(user).set({ twoFactorEnabled: true }).where(eq(user.id, operator.userId));
    const tokenOnly = (operator.headers.get("cookie") ?? "")
      .split("; ")
      .filter((c) => c.includes("session_token"))
      .join("; ");
    const asked = await auth.handler(
      new Request("http://localhost:3000/api/auth/admin/impersonate-user", {
        method: "POST",
        headers: {
          cookie: tokenOnly,
          "content-type": "application/json",
          origin: "http://localhost:3000",
        },
        body: JSON.stringify({ userId: gerant.userId }),
      }),
    );
    expect(asked.status).toBe(403);
    expect(await asked.json()).toMatchObject({ code: "SUPPORT_REASON_REQUIRED" });
  });

  it("is read-only, logs what the operator downloads and reads, and stays in its organization", async () => {
    const { gerant, first, operator } = await scenario();
    const operatorRef = { id: operator.userId, name: operator.name };
    const ctx: TenantCtx = {
      userId: gerant.userId,
      orgId: first.id,
      roles: ["owner"],
      locale: "fr",
      access: supportAccess(await loadTenantAccess(first.id), operatorRef),
    };
    expect(() => assertWritable(ctx)).toThrow(
      expect.objectContaining({ messageKey: "errors.readOnly.support" }),
    );

    // A floor plan (uploaded by the gérant before) downloaded during the session.
    const owner: TenantCtx = { ...ctx, access: undefined };
    const { id: projectId } = await createProject(
      owner,
      createProjectSchema.parse({ code: "SUPP", name: "Résidence Support", status: "planning" }),
    );
    const { id: buildingId } = await createBuilding(
      owner,
      createBuildingSchema.parse({
        projectId,
        code: "A",
        name: "Bloc A",
        lowestFloor: "0",
        topFloor: "2",
      }),
    );
    const { id: unitId } = await createUnit(
      owner,
      createUnitSchema.parse({
        buildingId,
        code: "A-01-01",
        floor: "1",
        type: "apartment",
        isDuplex: false,
        orientations: [],
      }),
    );
    const { fileId } = await setUnitFloorPlan(owner, {
      unitId,
      upload: {
        fileName: "plan.pdf",
        bytes: new TextEncoder().encode("%PDF-1.7\nplan\n%%EOF"),
      },
    });
    await getFileDownloadUrl(ctx, fileId, "attachment");
    const [download] = await tenantAudit(first.id, "support.download");
    expect(download).toMatchObject({
      actorUserId: operator.userId,
      entityType: "unit",
      entityId: unitId,
      after: { fileId, fileName: "plan.pdf" },
    });

    // A personal file opened during the session is logged as the operator's read.
    await withTenant(ctx, (tx) => recordAccess(tx, ctx, "lead", unitId));
    const [read] = await withTenant(ctx, (tx) =>
      tx
        .select({ userId: dataAccess.userId })
        .from(dataAccess)
        .where(eq(dataAccess.subjectId, unitId)),
    );
    expect(read?.userId).toBe(operator.userId);

    // The gérant's other company stays out of reach (no group view).
    expect(await getGroupOverview(ctx)).toBeNull();
  });
});
