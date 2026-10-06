import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PortalDocumentUpload } from "@/components/portal/document-upload";
import { PortalDocument } from "@/components/portal/portal-document";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toLocale } from "@/i18n/locales";
import { listPortalBuyerDocuments } from "@/server/portal/documents";
import { requirePortalCtx } from "@/server/portal/page-guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.documents");
  return { title: t("title") };
}

const statusVariant = {
  missing: "outline",
  received: "secondary",
  verified: "default",
} as const;

/** The buyer's own file: the pieces asked for, their state, and sending a scan. */
export default async function PortalDocumentsPage({
  params,
}: PageProps<"/[locale]/portal/documents">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePortalCtx();
  const files = await listPortalBuyerDocuments(ctx);
  const t = await getTranslations("portal.documents");
  const tb = await getTranslations("buyers.documents");

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">{t("title")}</h1>
        <p className="text-sm text-muted-foreground">{t("description")}</p>
      </div>
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        files.map((f) => (
          <Card key={f.id} data-testid="portal-buyer-file">
            <CardHeader>
              <CardTitle className="text-base">
                {t("file", { name: `${f.firstName} ${f.lastName}` })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y text-sm">
                {f.documents.map((d) => (
                  <li
                    key={d.kind}
                    className="flex flex-wrap items-center justify-between gap-2 py-2"
                    data-kind={d.kind}
                  >
                    <span className="space-y-0.5">
                      <span className="font-medium">{tb(`kind.${d.kind}`)}</span>
                      {d.required ? (
                        <span className="ms-2 text-xs text-muted-foreground">{tb("required")}</span>
                      ) : null}
                      {d.fileId ? (
                        <span className="block">
                          <PortalDocument fileId={d.fileId} label={tb("view")} />
                        </span>
                      ) : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge variant={statusVariant[d.status]}>
                        {d.status === "received" && d.submittedFromPortal
                          ? t("toVerify")
                          : tb(`status.${d.status}`)}
                      </Badge>
                      {d.status === "verified" ? null : (
                        <PortalDocumentUpload
                          buyerId={f.id}
                          kind={d.kind}
                          replace={d.fileId !== null}
                        />
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
