"use client";

import { MoreHorizontal, UserMinus } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/dates";
import { isStaffRole, type StaffRole, staffRoles } from "@/lib/permissions";
import { removeMemberAction, updateMemberRolesAction } from "@/server/organizations/actions";
import type { MemberRow } from "@/server/organizations/queries";

export function MembersTable({
  members,
  currentUserId,
  canManage,
  canRemove,
}: {
  members: MemberRow[];
  currentUserId: string;
  canManage: boolean;
  canRemove: boolean;
}) {
  const t = useTranslations();
  const updateRoles = useAction(updateMemberRolesAction);
  const remove = useAction(removeMemberAction);
  const [toRemove, setToRemove] = useState<MemberRow | null>(null);

  function toggleRole(row: MemberRow, role: StaffRole, checked: boolean) {
    const current = row.roles.filter(isStaffRole);
    const roles = checked ? [...current, role] : current.filter((r) => r !== role);
    if (roles.length === 0) return;
    void updateRoles.run(
      { memberId: row.id, roles },
      { onSuccess: () => toast.success(t("members.updated")) },
    );
  }

  const showActions = canManage || canRemove;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border">
        <Table data-testid="members-table">
          <TableHeader>
            <TableRow>
              <TableHead>{t("members.columns.name")}</TableHead>
              <TableHead>{t("members.columns.email")}</TableHead>
              <TableHead>{t("members.columns.roles")}</TableHead>
              <TableHead>{t("members.columns.joined")}</TableHead>
              {showActions ? (
                <TableHead className="w-12">
                  <span className="sr-only">{t("members.columns.actions")}</span>
                </TableHead>
              ) : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((row) => {
              const isOwner = row.roles.includes("owner");
              return (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">
                    {row.name}
                    {row.userId === currentUserId ? (
                      <span className="ms-1 text-muted-foreground">({t("members.you")})</span>
                    ) : null}
                  </TableCell>
                  <TableCell dir="ltr" className="text-start">
                    {row.email}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {row.roles.map((role) => (
                        <Badge key={role} variant={role === "owner" ? "default" : "secondary"}>
                          {t(`roles.${role}`)}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>{formatDate(row.joinedAt)}</TableCell>
                  {showActions ? (
                    <TableCell>
                      {isOwner ? null : (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("members.actions", { name: row.name })}
                              disabled={updateRoles.pending || remove.pending}
                            >
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="min-w-56">
                            {canManage ? (
                              <>
                                <DropdownMenuLabel>{t("members.editRoles")}</DropdownMenuLabel>
                                {staffRoles.map((role) => (
                                  <DropdownMenuCheckboxItem
                                    key={role}
                                    checked={row.roles.includes(role)}
                                    onCheckedChange={(checked) => toggleRole(row, role, checked)}
                                    onSelect={(event) => event.preventDefault()}
                                  >
                                    {t(`roles.${role}`)}
                                  </DropdownMenuCheckboxItem>
                                ))}
                              </>
                            ) : null}
                            {canManage && canRemove ? <DropdownMenuSeparator /> : null}
                            {canRemove ? (
                              <DropdownMenuItem
                                variant="destructive"
                                onSelect={() => setToRemove(row)}
                              >
                                <UserMinus className="size-4" />
                                {t("members.remove")}
                              </DropdownMenuItem>
                            ) : null}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <AlertDialog open={toRemove !== null} onOpenChange={(open) => !open && setToRemove(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("members.removeTitle", { name: toRemove?.name ?? "" })}
            </AlertDialogTitle>
            <AlertDialogDescription>{t("members.removeDescription")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("members.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={remove.pending}
              onClick={() => {
                if (!toRemove) return;
                void remove.run(
                  { memberId: toRemove.id },
                  {
                    onSuccess: () => {
                      toast.success(t("members.removed"));
                      setToRemove(null);
                    },
                  },
                );
              }}
            >
              {t("members.confirmRemove")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
