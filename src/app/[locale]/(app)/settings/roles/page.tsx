import { Archive } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { CustomRoleDialog } from "@/components/roles/custom-role-dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { isGrantablePermission, isStaffRole, splitPermission } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { archiveCustomRoleAction } from "@/server/organizations/actions";
import { listCustomRoles } from "@/server/organizations/custom-roles";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("customRoles");
  return { title: t("title") };
}

/**
 * The organization's own roles (CLAUDE.md §5 Auth & roles): each a name, the staff role it
 * starts from and the exact permissions its members hold; given to members on the members page.
 */
export default async function CustomRolesPage({ params }: PageProps<"/[locale]/settings/roles">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("member:update");
  const roles = await listCustomRoles(ctx);
  const t = await getTranslations("customRoles");
  const tr = await getTranslations("roles");

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<CustomRoleDialog />}
      />
      {roles.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <div className="space-y-4" data-testid="custom-roles">
          {roles.map((role) => {
            const baseRole = isStaffRole(role.baseRole) ? role.baseRole : "sales_agent";
            const permissions = role.permissions.filter(isGrantablePermission);
            return (
              <Card key={role.id} data-role={role.name}>
                <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2">
                  <div className="space-y-1">
                    <CardTitle className="text-base">{role.name}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {t("line", {
                        base: tr(baseRole),
                        count: permissions.length,
                        members: role.members,
                      })}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <CustomRoleDialog
                      current={{ id: role.id, name: role.name, baseRole, permissions }}
                    />
                    {role.members === 0 ? (
                      <ConfirmAction
                        action={archiveCustomRoleAction}
                        input={{ customRoleId: role.id }}
                        label={t("archive")}
                        icon={<Archive data-icon="inline-start" />}
                        title={t("archiveTitle", { name: role.name })}
                        description={t("archiveDescription")}
                        confirmLabel={t("archive")}
                        successMessage={t("archived")}
                      />
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="flex flex-wrap gap-1">
                  {permissions.map((p) => {
                    const [resource, action] = splitPermission(p);
                    return (
                      <Badge key={p} variant="secondary">
                        {t(`resources.${resource}`)} · {t(`actions.${action}`)}
                      </Badge>
                    );
                  })}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
