import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { CreateCaptureKeyDialog } from "@/components/crm/capture-keys";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/dates";
import { requirePermission } from "@/server/auth/page-guard";
import { CAPTURE_PER_MINUTE, captureEndpoint, listCaptureKeys } from "@/server/crm/capture";
import { revokeCaptureKeyAction } from "@/server/crm/capture-actions";
import { listProjectOptions } from "@/server/inventory/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("capture");
  return { title: t("title") };
}

/** Keys websites and automations use to send leads (CLAUDE.md §7 CRM). */
export default async function LeadCapturePage({
  params,
}: PageProps<"/[locale]/settings/lead-capture">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("lead:assign");
  const keys = await listCaptureKeys(ctx);
  const projects = await listProjectOptions(ctx);
  const endpoint = captureEndpoint(ctx.orgId);
  const t = await getTranslations("capture");
  const ts = await getTranslations("crm.source");

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title={t("title")}
        description={t("description")}
        actions={<CreateCaptureKeyDialog endpoint={endpoint} projects={projects} />}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("howTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>{t("how", { limit: CAPTURE_PER_MINUTE })}</p>
          <pre className="overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs" dir="ltr">
            {`POST ${endpoint}
Authorization: Bearer lck_…
{ "fullName": "…", "phone": "…", "email": "…", "city": "…",
  "source": "facebook", "project": "OLIV", "message": "…", "campaign": "…" }`}
          </pre>
          <p className="text-muted-foreground">{t("secret")}</p>
        </CardContent>
      </Card>
      {keys.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("none")}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table data-testid="capture-keys">
            <TableHeader>
              <TableRow>
                <TableHead>{t("columns.name")}</TableHead>
                <TableHead>{t("columns.key")}</TableHead>
                <TableHead>{t("columns.defaults")}</TableHead>
                <TableHead>{t("columns.lastUsed")}</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {keys.map((k) => (
                <TableRow key={k.id} data-key={k.name}>
                  <TableCell className="whitespace-normal">
                    <span className="font-medium">{k.name}</span>
                    <span className="block text-xs text-muted-foreground">
                      {t("createdBy", {
                        name: k.createdByName,
                        date: formatDateTime(k.createdAt),
                      })}
                    </span>
                  </TableCell>
                  <TableCell className="font-mono text-xs" dir="ltr">
                    {k.prefix}…
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {ts(k.source)}
                    {k.projectName ? ` · ${k.projectName}` : ""}
                  </TableCell>
                  <TableCell>{k.lastUsedAt ? formatDateTime(k.lastUsedAt) : "—"}</TableCell>
                  <TableCell className="text-end">
                    {k.revokedAt ? (
                      <Badge variant="secondary">{t("revoked")}</Badge>
                    ) : (
                      <ConfirmAction
                        action={revokeCaptureKeyAction}
                        input={{ keyId: k.id }}
                        label={t("revoke")}
                        title={t("revokeTitle", { name: k.name })}
                        description={t("revokeHint")}
                        confirmLabel={t("revoke")}
                        successMessage={t("revokedDone")}
                        variant="ghost"
                        size="sm"
                        destructive
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
