"use client";

import { useTranslations } from "next-intl";
import type { FormEventHandler, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/** Trigger button → dialog holding a react-hook-form form, with one submit button. */
export function FormDialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  submitLabel,
  pending,
  onSubmit,
  destructive = false,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trigger: ReactNode;
  title: string;
  description?: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  destructive?: boolean;
  /** Extra classes of the dialog (a wider one: `sm:max-w-3xl`). */
  className?: string;
  children?: ReactNode;
}) {
  const tc = useTranslations("common");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        closeLabel={tc("close")}
        className={cn("max-h-[calc(100dvh-2rem)] overflow-y-auto", className)}
      >
        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : null}
          </DialogHeader>
          {children ? <FieldGroup>{children}</FieldGroup> : null}
          <DialogFooter>
            <Button
              type="submit"
              variant={destructive ? "destructive" : "default"}
              disabled={pending}
            >
              {submitLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
