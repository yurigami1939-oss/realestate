import { FileText, Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

/** Link to a document's PDF; while the worker renders it, a pending note. */
export function PortalDocument({ fileId, label }: { fileId: string | null; label: string }) {
  const t = useTranslations("portal");
  if (!fileId) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        {label} · {t("pendingDocument")}
      </span>
    );
  }
  return (
    <a
      href={`/api/files/${fileId}`}
      target="_blank"
      rel="noopener"
      className="inline-flex items-center gap-1.5 text-sm font-medium hover:underline"
    >
      <FileText className="size-4" aria-hidden />
      {label}
    </a>
  );
}
