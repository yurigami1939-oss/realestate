import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, member } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { auth } from "@/server/auth/auth";
import type { TenantCtx } from "@/server/auth/session";

import { createOrganizationAs, signUp } from "../../../tests/auth-helpers";

import { getMember } from "./queries";
import { cancelInvitation, inviteMember, removeMember, updateMemberRoles } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

async function ownerOfNewOrg() {
  const owner = await signUp("Owner");
  const org = await createOrganizationAs(owner.headers);
  const ctx: TenantCtx = { userId: owner.userId, orgId: org.id, roles: ["owner"], locale: "fr" };
  return { owner, org, ctx };
}

async function auditActions(orgId: string, entityId: string) {
  const rows = await withTenant({ orgId }, (tx) =>
    tx
      .select({
        action: auditLog.action,
        actor: auditLog.actorUserId,
        before: auditLog.before,
        after: auditLog.after,
      })
      .from(auditLog)
      .where(and(eq(auditLog.organizationId, orgId), eq(auditLog.entityId, entityId))),
  );
  return rows;
}

/** Invites and accepts; returns the new member id. */
async function addMember(
  ctx: TenantCtx,
  ownerHeaders: Headers,
  roles: ("cashier" | "accountant")[],
) {
  const invitee = await signUp("Staff");
  const { id } = await inviteMember(ctx, ownerHeaders, { email: invitee.email, roles });
  await auth.api.acceptInvitation({ body: { invitationId: id }, headers: invitee.headers });
  const [row] = await withTenant(ctx, (tx) =>
    tx
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, invitee.userId))),
  );
  if (!row) throw new Error("member not created");
  return row.id;
}

describe("member management service", () => {
  it("audits invitations with the acting user", async () => {
    const { owner, ctx } = await ownerOfNewOrg();
    const email = `new-${randomUUID().slice(0, 8)}@example.test`;

    const { id } = await inviteMember(ctx, owner.headers, { email, roles: ["sales_agent"] });
    await cancelInvitation(ctx, owner.headers, { invitationId: id });

    const actions = await auditActions(ctx.orgId, id);
    expect(actions.map((a) => a.action).sort()).toEqual(["invitation.cancel", "invitation.create"]);
    expect(actions.every((a) => a.actor === owner.userId)).toBe(true);
  });

  it("refuses to invite without invitation:create, before calling Better Auth", async () => {
    const { owner, ctx } = await ownerOfNewOrg();
    await expect(
      inviteMember({ ...ctx, roles: ["cashier"] }, owner.headers, {
        email: "x@example.test",
        roles: ["cashier"],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updates roles and removes members, auditing before/after", async () => {
    const { owner, ctx } = await ownerOfNewOrg();
    const memberId = await addMember(ctx, owner.headers, ["cashier"]);

    await updateMemberRoles(ctx, owner.headers, { memberId, roles: ["cashier", "accountant"] });
    expect((await getMember(ctx.orgId, memberId))?.roles).toEqual(["cashier", "accountant"]);

    await removeMember(ctx, owner.headers, { memberId });
    expect(await getMember(ctx.orgId, memberId)).toBeNull();

    const actions = await auditActions(ctx.orgId, memberId);
    expect(actions.map((a) => a.action).sort()).toEqual([
      "member.join",
      "member.remove",
      "member.update_roles",
    ]);
    expect(actions.find((a) => a.action === "member.update_roles")).toMatchObject({
      before: { roles: ["cashier"] },
      after: { roles: ["cashier", "accountant"] },
    });
  });

  it("never lets anyone change or remove the owner", async () => {
    const { owner, ctx } = await ownerOfNewOrg();
    const ownerMember = await withTenant(ctx, (tx) =>
      tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, owner.userId))),
    );
    const memberId = ownerMember[0]!.id;

    await expect(
      updateMemberRoles(ctx, owner.headers, { memberId, roles: ["cashier"] }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
      messageKey: "members.ownerLocked",
    });
    await expect(removeMember(ctx, owner.headers, { memberId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
