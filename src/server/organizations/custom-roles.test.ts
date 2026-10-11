import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { auditLog, member } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { stopEnqueue } from "@/jobs/enqueue";
import { can, grantablePermissions, rolePermissions } from "@/lib/permissions";
import { auth } from "@/server/auth/auth";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { createOrganizationAs, signUp } from "../../../tests/auth-helpers";

import {
  archiveCustomRole,
  assignCustomRole,
  createCustomRole,
  listCustomRoles,
  listMemberCustomRoles,
  loadCustomPermissions,
  updateCustomRole,
} from "./custom-roles";
import { getMember } from "./queries";
import { customRoleSchema, updateMemberRolesSchema } from "./schemas";
import { inviteMember, updateMemberRoles } from "./service";

afterAll(async () => {
  await stopEnqueue();
});

describe("custom roles", () => {
  it("lets a custom role decide exactly what its members may do", () => {
    const access = { roles: ["cashier" as const], permissions: ["lead:read" as const] };
    expect(can(access, "lead:read")).toBe(true);
    // The base role no longer counts.
    expect(can(access, "payment:create")).toBe(false);
    expect(can(["cashier"], "payment:create")).toBe(true);
    expect(can({ roles: ["cashier"], permissions: null }, "payment:create")).toBe(true);
    expect(rolePermissions("cashier")).toContain("payment:create");
    expect(grantablePermissions).not.toContain("member:update");
    expect(
      customRoleSchema.safeParse({ name: "X", baseRole: "cashier", permissions: [] }).success,
    ).toBe(false);
    expect(
      customRoleSchema.safeParse({
        name: "X",
        baseRole: "cashier",
        permissions: ["member:update"],
      }).success,
    ).toBe(false);
    expect(
      customRoleSchema.safeParse({ name: "X", baseRole: "owner", permissions: ["lead:read"] })
        .success,
    ).toBe(false);
  });

  it("defines a role, gives it to a member, follows its changes and archives it", async () => {
    const owner = await signUp("Owner");
    const org = await createOrganizationAs(owner.headers);
    const ctx: TenantCtx = { userId: owner.userId, orgId: org.id, roles: ["owner"], locale: "fr" };
    const invitee = await signUp("Staff");
    const { id: invitationId } = await inviteMember(ctx, owner.headers, {
      email: invitee.email,
      roles: ["cashier"],
    });
    await auth.api.acceptInvitation({ body: { invitationId }, headers: invitee.headers });
    const [row] = await withTenant(ctx, (tx) =>
      tx
        .select({ id: member.id })
        .from(member)
        .where(and(eq(member.organizationId, org.id), eq(member.userId, invitee.userId))),
    );
    const memberId = row?.id ?? "";
    const cashierCtx: TenantCtx = { ...ctx, userId: invitee.userId, roles: ["cashier"] };

    // An assistant who records payments and reads the leads, nothing else.
    const input = customRoleSchema.parse({
      name: "Assistante commerciale",
      baseRole: "sales_agent",
      permissions: ["lead:read", "lead:read_all", "payment:create"],
    });
    await expect(createCustomRole(cashierCtx, input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { id: customRoleId } = await createCustomRole(ctx, input);
    await expect(createCustomRole(ctx, input)).rejects.toMatchObject({
      messageKey: "customRoles.errors.nameTaken",
    });

    await assignCustomRole(ctx, owner.headers, { memberId, customRoleId });
    expect((await getMember(org.id, memberId))?.roles).toEqual(["sales_agent"]);
    const permissions = await loadCustomPermissions(org.id, invitee.userId);
    expect(permissions).toEqual(["lead:read", "lead:read_all", "payment:create"]);
    const held: TenantCtx = { ...cashierCtx, roles: ["sales_agent"], permissions };
    expect(() => assertCan(held, "lead:read_all")).not.toThrow();
    expect(() => assertCan(held, "quotation:create")).toThrow();
    expect((await listMemberCustomRoles(ctx)).get(invitee.userId)?.name).toBe(
      "Assistante commerciale",
    );
    await expect(archiveCustomRole(ctx, { customRoleId })).rejects.toMatchObject({
      messageKey: "customRoles.errors.held",
    });

    // A change reaches its members, the base role too.
    await updateCustomRole(ctx, owner.headers, {
      ...input,
      customRoleId,
      baseRole: "cashier",
      permissions: ["payment:read", "payment:create"],
    });
    expect(await loadCustomPermissions(org.id, invitee.userId)).toEqual([
      "payment:read",
      "payment:create",
    ]);
    expect((await getMember(org.id, memberId))?.roles).toEqual(["cashier"]);

    // Choosing their roles by hand ends the custom role; then it can be archived.
    await updateMemberRoles(
      ctx,
      owner.headers,
      updateMemberRolesSchema.parse({ memberId, roles: ["accountant"] }),
    );
    expect(await loadCustomPermissions(org.id, invitee.userId)).toBeNull();
    expect((await listCustomRoles(ctx))[0]?.members).toBe(0);
    await archiveCustomRole(ctx, { customRoleId });
    expect(await listCustomRoles(ctx)).toEqual([]);

    const audits = await withTenant(ctx, (tx) =>
      tx
        .select({ action: auditLog.action })
        .from(auditLog)
        .where(eq(auditLog.organizationId, org.id)),
    );
    expect(audits.map((a) => a.action)).toEqual(
      expect.arrayContaining([
        "organization.custom_role",
        "member.custom_role",
        "organization.custom_role_archive",
      ]),
    );
  });
});
