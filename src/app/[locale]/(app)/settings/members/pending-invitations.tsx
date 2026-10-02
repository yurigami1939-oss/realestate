"use client";

import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/dates";
import { cancelInvitationAction } from "@/server/organizations/actions";
import type { InvitationRow } from "@/server/organizations/queries";

export function PendingInvitations({
  invitations,
  canCancel,
}: {
  invitations: InvitationRow[];
  canCancel: boolean;
}) {
  const t = useTranslations();
  const cancel = useAction(cancelInvitationAction);

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>{t("members.pending.title")}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {invitations.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("members.pending.empty")}</p>
        ) : (
          <ul className="divide-y" data-testid="pending-invitations">
            {invitations.map((invitation) => (
              <li key={invitation.id} className="flex items-start justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <p className="truncate text-sm font-medium" dir="ltr">
                    {invitation.email}
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {invitation.roles.map((role) => (
                      <Badge key={role} variant="secondary">
                        {t(`roles.${role}`)}
                      </Badge>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("members.pending.expires", { date: formatDate(invitation.expiresAt) })}
                  </p>
                </div>
                {canCancel ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    disabled={cancel.pending}
                    aria-label={t("members.pending.cancel")}
                    title={t("members.pending.cancel")}
                    onClick={() =>
                      cancel.run(
                        { invitationId: invitation.id },
                        { onSuccess: () => toast.success(t("members.pending.cancelled")) },
                      )
                    }
                  >
                    <X />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
