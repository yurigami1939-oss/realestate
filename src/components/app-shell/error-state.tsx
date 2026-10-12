"use client";

import { House, RotateCw, TriangleAlert } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

/**
 * What an area shows when its page fails (`error.tsx`, CLAUDE.md §14 item 11): a calm message,
 * « Réessayer » (fetches and renders the page again) and the way home; the error's reference
 * matches the server's log without revealing its details.
 */
export function ErrorState({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const t = useTranslations();
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div
      className="mx-auto flex max-w-md flex-col items-center gap-5 py-16 text-center"
      role="alert"
    >
      <span className="flex size-14 items-center justify-center rounded-2xl bg-warning-soft text-warning">
        <TriangleAlert className="size-7" aria-hidden />
      </span>
      <div className="space-y-1.5">
        <h1 className="text-title">{t("errorPage.title")}</h1>
        <p className="text-muted-foreground">{t("errorPage.description")}</p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => retry()}>
          <RotateCw data-icon="inline-start" />
          {t("errorPage.retry")}
        </Button>
        <Button asChild variant="outline">
          <Link href="/">
            <House data-icon="inline-start" />
            {t("common.backHome")}
          </Link>
        </Button>
      </div>
      {error.digest ? (
        <p className="text-footnote text-muted-foreground">
          {t("errorPage.reference", { digest: error.digest })}
        </p>
      ) : null}
    </div>
  );
}
