"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";

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
import { useRouter } from "@/i18n/navigation";
import type { Result } from "@/lib/result";

import { useAction } from "./use-action";

/** Button → confirmation dialog → Server Action → toast (+ optional navigation). */
export function ConfirmAction<I, T>({
  action,
  input,
  label,
  icon,
  title,
  description,
  confirmLabel,
  successMessage,
  redirectTo,
  destructive = false,
  variant = "outline",
}: {
  action: (input: I) => Promise<Result<T>>;
  input: I;
  label: string;
  icon?: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  successMessage: string | ((data: T) => string);
  redirectTo?: string;
  destructive?: boolean;
  variant?: "outline" | "default" | "ghost" | "destructive";
}) {
  const tc = useTranslations("common");
  const router = useRouter();
  const run = useAction(action);
  const [open, setOpen] = useState(false);

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant={variant}>
          {icon}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tc("cancel")}</AlertDialogCancel>
          <AlertDialogAction
            variant={destructive ? "destructive" : "default"}
            disabled={run.pending}
            onClick={(event) => {
              event.preventDefault();
              void run.run(input, {
                onSuccess: (data) => {
                  toast.success(
                    typeof successMessage === "function" ? successMessage(data) : successMessage,
                  );
                  setOpen(false);
                  if (redirectTo) router.push(redirectTo);
                },
                onError: () => {
                  setOpen(false);
                  return false;
                },
              });
            }}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
