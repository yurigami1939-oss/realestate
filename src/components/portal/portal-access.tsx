"use client";

import { MailPlus, UserX } from "lucide-react";
import { useTranslations } from "next-intl";

import { ConfirmAction } from "@/components/forms/confirm-action";
import { Badge } from "@/components/ui/badge";
import {
  inviteBuyerToPortalAction,
  inviteResidentToPortalAction,
  revokePortalLinkAction,
} from "@/server/portal/actions";
import type { PortalAccess } from "@/server/portal/invitations";

/**
 * Portal access of a buyer file or a co-owner / occupant: its state, and invite / renew /
 * withdraw for members who may invite (CLAUDE.md §12: access by invitation only).
 */
export function PortalAccessControl({
  target,
  email,
  access,
  editable,
}: {
  target: { kind: "buyer" | "resident"; id: string };
  email: string | null;
  access: PortalAccess | null;
  editable: boolean;
}) {
  const t = useTranslations("portal.access");
  const invite = (label: string) => {
    if (!email) return null;
    const props = {
      label,
      icon: <MailPlus data-icon="inline-start" />,
      title: t("inviteTitle"),
      description: t("inviteDescription", { email }),
      confirmLabel: label,
      successMessage: ({ status }: { status: "invited" | "linked" }) =>
        status === "linked" ? t("linkedDone") : t("invitedDone"),
      variant: "outline" as const,
    };
    return target.kind === "buyer" ? (
      <ConfirmAction action={inviteBuyerToPortalAction} input={{ buyerId: target.id }} {...props} />
    ) : (
      <ConfirmAction
        action={inviteResidentToPortalAction}
        input={{ residentId: target.id }}
        {...props}
      />
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm" data-testid="portal-access">
      {access ? (
        <Badge
          variant={access.state === "active" ? "secondary" : "outline"}
          className={access.state === "expired" ? "text-amber-800" : undefined}
        >
          {t(`state.${access.state}`, { email: access.email })}
        </Badge>
      ) : (
        <span className="text-muted-foreground">{email ? t("none") : t("noEmail")}</span>
      )}
      {editable && (!access || access.state !== "active")
        ? invite(access ? t("reinvite") : t("invite"))
        : null}
      {editable && access ? (
        <ConfirmAction
          action={revokePortalLinkAction}
          input={{ linkId: access.linkId }}
          label={t("revoke")}
          icon={<UserX data-icon="inline-start" />}
          title={t("revokeTitle")}
          description={t("revokeDescription")}
          confirmLabel={t("revoke")}
          successMessage={t("revokedDone")}
          destructive
          variant="ghost"
        />
      ) : null}
    </div>
  );
}
