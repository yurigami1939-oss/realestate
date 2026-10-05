import { Pin } from "lucide-react";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PortalDocument } from "@/components/portal/portal-document";
import { Badge } from "@/components/ui/badge";
import { toLocale } from "@/i18n/locales";
import { formatDate } from "@/lib/dates";
import { requirePortalCtx } from "@/server/portal/page-guard";
import { listPortalAnnouncements } from "@/server/portal/residences";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.shell.nav");
  return { title: t("announcements") };
}

/** The announcements shown now in the account's residences (pinned first). */
export default async function PortalAnnouncementsPage({
  params,
}: PageProps<"/[locale]/portal/announcements">) {
  const { locale } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePortalCtx();
  const announcements = await listPortalAnnouncements(ctx);
  const t = await getTranslations("portal.announcements");
  const ta = await getTranslations("announcements");

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">{t("title")}</h1>
      {announcements.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <ul className="space-y-3" data-testid="portal-announcements">
          {announcements.map((a) => (
            <li key={a.id} className="rounded-lg border bg-background p-4">
              <div className="flex flex-wrap items-center gap-2">
                {a.pinned ? <Pin className="size-4" aria-label={ta("pinned")} /> : null}
                <h2 className="font-medium">{a.title}</h2>
                <Badge variant="outline">{ta(`category.${a.category}`)}</Badge>
              </div>
              {a.titleAr ? (
                <div dir="rtl" lang="ar" className="w-fit font-medium">
                  {a.titleAr}
                </div>
              ) : null}
              <p className="text-xs text-muted-foreground">
                {a.residenceName}
                {a.publishedAt ? ` · ${formatDate(a.publishedAt)}` : ""}
                {a.expiresOn ? ` · ${ta("until", { date: formatDate(a.expiresOn) })}` : ""}
              </p>
              <p className="mt-2 text-sm whitespace-pre-line">{a.body}</p>
              {a.bodyAr ? (
                <p dir="rtl" lang="ar" className="mt-2 text-sm whitespace-pre-line">
                  {a.bodyAr}
                </p>
              ) : null}
              {a.pdfFileId ? (
                <div className="mt-2">
                  <PortalDocument fileId={a.pdfFileId} label={ta("pdf")} />
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
