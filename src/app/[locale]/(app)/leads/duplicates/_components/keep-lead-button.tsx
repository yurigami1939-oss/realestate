"use client";

import { useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { useTranslateKey } from "@/components/forms/text-field";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { mergeLeadsAction } from "@/server/crm/actions";

/** Keeps this lead and merges the other leads of the same phone into it, one by one. */
export function KeepLeadButton({
  targetId,
  name,
  sourceIds,
}: {
  targetId: string;
  name: string;
  sourceIds: string[];
}) {
  const t = useTranslations("crm");
  const tc = useTranslations("common");
  const translate = useTranslateKey();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const keep = () =>
    startTransition(async () => {
      for (const sourceId of sourceIds) {
        const result = await mergeLeadsAction({ targetId, sourceId });
        if (!result.ok) {
          toast.error(translate(result.error.messageKey));
          setOpen(false);
          return;
        }
      }
      toast.success(t("leads.merged"));
      setOpen(false);
    });

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm">
          {t("duplicates.keep")}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t("duplicates.keepTitle", { name })}</AlertDialogTitle>
          <AlertDialogDescription>{t("duplicates.keepDescription")}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault();
              keep();
            }}
          >
            {t("duplicates.keep")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
