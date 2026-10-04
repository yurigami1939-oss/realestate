import { Archive, Pin, Send, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { AnnouncementDialog } from "@/components/announcements/announcement-dialog";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { ChargeDocumentPdf } from "@/components/residences/charge-document-pdf";
import { PendingDocumentsRefresher } from "@/components/sales/document-pdf";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import type { AnnouncementState } from "@/lib/announcements";
import { formatDate } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { cn } from "@/lib/utils";
import {
  archiveAnnouncementAction,
  deleteAnnouncementAction,
  publishAnnouncementAction,
} from "@/server/announcements/actions";
import { listAnnouncements } from "@/server/announcements/queries";
import { requirePermission } from "@/server/auth/page-guard";
import { getResidence } from "@/server/residences/queries";

import { ResidenceNav } from "../_components/residence-nav";

const stateVariants: Record<AnnouncementState, "default" | "secondary" | "outline"> = {
  published: "default",
  draft: "outline",
  expired: "secondary",
  archived: "secondary",
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("announcements");
  return { title: t("title") };
}

export default async function ResidenceAnnouncementsPage({
  params,
}: PageProps<"/[locale]/residences/[residenceId]/announcements">) {
  const { locale, residenceId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("announcement:read");
  const home = await getResidence(ctx, residenceId);
  if (!home) notFound();
  const announcements = await listAnnouncements(ctx, residenceId);
  const t = await getTranslations("announcements");
  const tr = await getTranslations("residences");
  const tc = await getTranslations("common");
  const editable = can(ctx.roles, "announcement:update");

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={home.name}
        description={home.projectName}
        crumbs={[{ label: tr("title"), href: "/residences" }]}
      />
      <ResidenceNav residenceId={residenceId} current="announcements" roles={ctx.roles} />
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <div className="space-y-1">
            <CardTitle className="text-base">{t("title")}</CardTitle>
            <p className="text-sm text-muted-foreground">{t("description")}</p>
          </div>
          {editable ? <AnnouncementDialog residenceId={residenceId} /> : null}
        </CardHeader>
        <CardContent>
          {announcements.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("empty")}</p>
          ) : (
            <ul className="space-y-3" data-testid="announcements">
              {announcements.map((a) => (
                <li
                  key={a.id}
                  className={cn(
                    "rounded-lg border p-4",
                    (a.state === "expired" || a.state === "archived") && "opacity-70",
                  )}
                  data-state={a.state}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {a.pinned && a.state === "published" ? (
                          <Pin className="size-4" aria-label={t("pinned")} />
                        ) : null}
                        <h3 className="font-medium">{a.title}</h3>
                        <Badge variant={stateVariants[a.state]}>{t(`state.${a.state}`)}</Badge>
                        <Badge variant="outline">{t(`category.${a.category}`)}</Badge>
                      </div>
                      {a.titleAr ? (
                        <div dir="rtl" lang="ar" className="w-fit font-medium">
                          {a.titleAr}
                        </div>
                      ) : null}
                      <p className="text-xs text-muted-foreground">
                        {a.publishedAt
                          ? t("publishedOn", {
                              date: formatDate(a.publishedAt),
                              name: a.publishedByName ?? "—",
                            })
                          : t("createdOn", { date: formatDate(a.createdAt) })}
                        {a.expiresOn ? ` · ${t("until", { date: formatDate(a.expiresOn) })}` : ""}
                      </p>
                    </div>
                    {editable ? (
                      <div className="flex flex-wrap gap-1">
                        {a.state === "draft" ? (
                          <>
                            <AnnouncementDialog residenceId={residenceId} announcement={a} />
                            <ConfirmAction
                              action={deleteAnnouncementAction}
                              input={{ announcementId: a.id }}
                              label={tc("delete")}
                              icon={<Trash2 data-icon="inline-start" />}
                              title={t("delete.title")}
                              description={t("delete.description")}
                              confirmLabel={tc("delete")}
                              successMessage={t("delete.done")}
                              destructive
                              variant="ghost"
                            />
                            <ConfirmAction
                              action={publishAnnouncementAction}
                              input={{ announcementId: a.id }}
                              label={t("publish.label")}
                              icon={<Send data-icon="inline-start" className="rtl:rotate-180" />}
                              title={t("publish.title")}
                              description={t("publish.description")}
                              confirmLabel={t("publish.label")}
                              successMessage={t("publish.done")}
                              variant="default"
                            />
                          </>
                        ) : null}
                        {a.state === "published" || a.state === "expired" ? (
                          <ConfirmAction
                            action={archiveAnnouncementAction}
                            input={{ announcementId: a.id }}
                            label={t("archive.label")}
                            icon={<Archive data-icon="inline-start" />}
                            title={t("archive.title")}
                            description={t("archive.description")}
                            confirmLabel={t("archive.label")}
                            successMessage={t("archive.done")}
                            variant="ghost"
                          />
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  <p className="mt-3 text-sm whitespace-pre-line">{a.body}</p>
                  {a.bodyAr ? (
                    <p dir="rtl" lang="ar" className="mt-2 text-sm whitespace-pre-line">
                      {a.bodyAr}
                    </p>
                  ) : null}
                  {a.publishedAt ? (
                    <div className="mt-2">
                      <ChargeDocumentPdf
                        fileId={a.pdfFileId}
                        kind="announcement"
                        id={a.id}
                        label={t("pdf")}
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
      <PendingDocumentsRefresher
        pending={announcements.some((a) => a.publishedAt && a.pdfFileId === null)}
      />
    </div>
  );
}
