"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Ban, Download, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import type { z } from "zod";

import { applyFieldErrors } from "@/components/forms/apply-field-errors";
import { TextareaField } from "@/components/forms/fields";
import { useAction } from "@/components/forms/use-action";
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
import { useRouter } from "@/i18n/navigation";
import { cancelQuotationAction, requestQuotationPdfAction } from "@/server/quotations/actions";
import { cancelQuotationSchema } from "@/server/quotations/schemas";

/** PDF links once rendered; until then, polls the page and offers to re-request the job. */
export function QuotationPdf({
  quotationId,
  pdfFileId,
}: {
  quotationId: string;
  pdfFileId: string | null;
}) {
  const t = useTranslations("quotations");
  const router = useRouter();
  const retry = useAction(requestQuotationPdfAction);
  const [polls, setPolls] = useState(0);

  useEffect(() => {
    if (pdfFileId || polls >= 20) return;
    const timer = setTimeout(() => {
      router.refresh();
      setPolls((n) => n + 1);
    }, 3000);
    return () => clearTimeout(timer);
  }, [pdfFileId, polls, router]);

  if (pdfFileId) {
    const href = `/api/files/${pdfFileId}`;
    return (
      <div className="flex flex-wrap gap-2" data-testid="quotation-pdf">
        <Button asChild>
          <a href={`${href}?download`}>
            <Download data-icon="inline-start" />
            {t("download")}
          </a>
        </Button>
        <Button asChild variant="outline">
          <a href={href} target="_blank" rel="noopener">
            <ExternalLink data-icon="inline-start" />
            {t("pdf")}
          </a>
        </Button>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm" data-testid="quotation-pdf">
      <span className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden />
        {t("pdfPending")}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={retry.pending}
        onClick={() =>
          void retry.run(
            { quotationId },
            {
              onSuccess: () => {
                toast.success(t("pdfRequested"));
                setPolls(0);
              },
            },
          )
        }
      >
        <RefreshCw data-icon="inline-start" />
        {t("pdfRetry")}
      </Button>
    </div>
  );
}

type CancelValues = z.input<typeof cancelQuotationSchema>;

export function CancelQuotationDialog({
  quotationId,
  number,
}: {
  quotationId: string;
  number: string;
}) {
  const t = useTranslations("quotations");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const run = useAction(cancelQuotationAction);
  const form = useForm<CancelValues, unknown, z.output<typeof cancelQuotationSchema>>({
    resolver: zodResolver(cancelQuotationSchema),
    defaultValues: { quotationId, reason: "" },
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost">
          <Ban data-icon="inline-start" />
          {t("cancel")}
        </Button>
      </DialogTrigger>
      <DialogContent closeLabel={tc("close")}>
        <DialogHeader>
          <DialogTitle>{t("cancelTitle", { number })}</DialogTitle>
          <DialogDescription>{t("cancelDescription")}</DialogDescription>
        </DialogHeader>
        <form
          id="cancel-quotation"
          onSubmit={form.handleSubmit(() =>
            run.run(form.getValues(), {
              onSuccess: () => {
                toast.success(t("cancelled"));
                setOpen(false);
              },
              onError: (error) => applyFieldErrors(form, error),
            }),
          )}
          noValidate
        >
          <FieldGroup>
            <TextareaField
              control={form.control}
              name="reason"
              label={t("cancelReason")}
              rows={2}
            />
          </FieldGroup>
        </form>
        <DialogFooter>
          <Button
            type="submit"
            form="cancel-quotation"
            variant="destructive"
            disabled={run.pending}
          >
            {t("cancel")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
