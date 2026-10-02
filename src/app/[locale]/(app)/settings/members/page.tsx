import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { toLocale } from "@/i18n/locales";
import { can } from "@/lib/permissions";
import { requireTenantCtx } from "@/server/auth/page-guard";
import { listMembers, listPendingInvitations } from "@/server/organizations/queries";

import { InviteMemberForm } from "./invite-member-form";
import { MembersTable } from "./members-table";
import { PendingInvitations } from "./pending-invitations";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("members");
  return { title: t("title") };
}

export default async function MembersPage({ params }: PageProps<"/[locale]/settings/members">) {
  setRequestLocale(toLocale((await params).locale));
  const t = await getTranslations("members");
  const ctx = await requireTenantCtx();
  const canInvite = can(ctx.roles, "invitation:create");

  const [members, invitations] = await Promise.all([
    listMembers(ctx.orgId),
    canInvite ? listPendingInvitations(ctx.orgId) : Promise.resolve([]),
  ]);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">{t("title")}</h1>
        <p className="text-muted-foreground">{t("description")}</p>
      </div>
      <MembersTable
        members={members}
        currentUserId={ctx.userId}
        canManage={can(ctx.roles, "member:update")}
        canRemove={can(ctx.roles, "member:delete")}
      />
      {canInvite ? (
        <div className="grid gap-8 lg:grid-cols-2">
          <InviteMemberForm />
          <PendingInvitations
            invitations={invitations}
            canCancel={can(ctx.roles, "invitation:cancel")}
          />
        </div>
      ) : null}
    </div>
  );
}
