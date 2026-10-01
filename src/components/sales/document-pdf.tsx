"use client";

import { FileText, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import { useRouter } from "@/i18n/navigation";
import { requestSaleDocumentAction } from "@/server/sales/actions";

type Kind = "reservation_sheet" | "receipt" | "payment_call" | "reminder_letter";

/** Link to a generated PDF; while the worker renders it, a pending note and a retry button. */
export function DocumentPdf({
  fileId,
  kind,
  id,
  label,
}: {
  fileId: string | null;
  kind: Kind;
  id: string;
  label: string;
}) {
  const t = useTranslations("sales.documents");
  const retry = useAction(requestSaleDocumentAction);
  if (fileId) {
    return (
      <Button asChild variant="link" size="sm" className="h-auto px-0">
        <a href={`/api/files/${fileId}`} target="_blank" rel="noopener">
          <FileText data-icon="inline-start" />
          {label}
        </a>
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" aria-hidden />
      {t("pending")}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7"
        aria-label={t("retry")}
        disabled={retry.pending}
        onClick={() =>
          void retry.run({ kind, id }, { onSuccess: () => toast.success(t("requested")) })
        }
      >
        <RefreshCw />
      </Button>
    </span>
  );
}

/** Refreshes the page while documents are rendering (every 3 s, at most a minute). */
export function PendingDocumentsRefresher({ pending }: { pending: boolean }) {
  const router = useRouter();
  const [polls, setPolls] = useState(0);
  useEffect(() => {
    if (!pending || polls >= 20) return;
    const timer = setTimeout(() => {
      router.refresh();
      setPolls((n) => n + 1);
    }, 3000);
    return () => clearTimeout(timer);
  }, [pending, polls, router]);
  return null;
}
