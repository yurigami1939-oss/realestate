"use client";

import { FileText, Loader2, RefreshCw } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useSearchParamsState } from "@/components/data-table/use-search-params-state";
import { useAction } from "@/components/forms/use-action";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { LeaseState, RegistrationState } from "@/lib/rentals";
import { cn } from "@/lib/utils";
import { requestInspectionReportAction, requestRentReceiptAction } from "@/server/rentals/actions";

const stateClasses: Record<LeaseState, string> = {
  upcoming: "border-info/25 bg-info-soft text-info",
  running: "border-success/25 bg-success-soft text-success",
  ending: "border-warning/25 bg-warning-soft text-warning",
  expired: "border-danger/25 bg-danger-soft text-danger",
  ended: "border-border bg-muted text-muted-foreground",
};

/** Where a lease stands (derived from its dates). */
export function LeaseStateBadge({ state }: { state: LeaseState }) {
  const t = useTranslations("rentals.state");
  return (
    <span
      className={cn(
        "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        stateClasses[state],
      )}
      data-state={state}
    >
      {t(state)}
    </span>
  );
}

/** An active lease still to register at the tax office (late past its deadline). */
export function RegistrationBadge({ state }: { state: RegistrationState | null }) {
  const t = useTranslations("rentals.registration");
  if (state === null || state === "registered") return null;
  return (
    <span
      className={cn(
        "inline-flex h-5.5 items-center rounded-full border px-2.5 text-xs font-medium whitespace-nowrap",
        state === "late"
          ? "border-danger/25 bg-danger-soft text-danger"
          : "border-warning/25 bg-warning-soft text-warning",
      )}
      data-registration={state}
    >
      {t(`badge.${state}`)}
    </span>
  );
}

/** Link to a quittance; while the worker renders it, a pending note and a retry button. */
export function RentReceiptPdf({
  fileId,
  paymentId,
  label,
}: {
  fileId: string | null;
  paymentId: string;
  label: string;
}) {
  const retry = useAction(requestRentReceiptAction);
  return (
    <PendingPdf
      fileId={fileId}
      label={label}
      pending={retry.pending}
      onRetry={(done) => void retry.run({ paymentId }, { onSuccess: done })}
    />
  );
}

/** Link to an état des lieux; while the worker renders it, a pending note and a retry button. */
export function InspectionPdf({
  fileId,
  inspectionId,
  label,
}: {
  fileId: string | null;
  inspectionId: string;
  label: string;
}) {
  const retry = useAction(requestInspectionReportAction);
  return (
    <PendingPdf
      fileId={fileId}
      label={label}
      pending={retry.pending}
      onRetry={(done) => void retry.run({ inspectionId }, { onSuccess: done })}
    />
  );
}

export function PendingPdf({
  fileId,
  label,
  pending,
  onRetry,
}: {
  fileId: string | null;
  label: string;
  pending: boolean;
  onRetry: (done: () => void) => void;
}) {
  const t = useTranslations("sales.documents");
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
        disabled={pending}
        onClick={() => onRetry(() => toast.success(t("requested")))}
      >
        <RefreshCw />
      </Button>
    </span>
  );
}

const ALL = "__all__";

/** Status and project filters of the leases list, kept in the URL (active ones by default). */
export function LeaseFilters({ projects }: { projects: { id: string; name: string }[] }) {
  const t = useTranslations("rentals");
  const params = useSearchParamsState();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select
        value={params.get("status") || "active"}
        onValueChange={(value) => params.set({ status: value === "active" ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-48" aria-label={t("columns.status")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="active">{t("filters.active")}</SelectItem>
          <SelectItem value="ended">{t("filters.ended")}</SelectItem>
          <SelectItem value="all">{t("filters.all")}</SelectItem>
        </SelectContent>
      </Select>
      <Select
        value={params.get("project") || ALL}
        onValueChange={(value) => params.set({ project: value === ALL ? null : value })}
      >
        <SelectTrigger className="w-full sm:w-64" aria-label={t("filters.allProjects")}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>{t("filters.allProjects")}</SelectItem>
          {projects.map((p) => (
            <SelectItem key={p.id} value={p.id}>
              {p.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
