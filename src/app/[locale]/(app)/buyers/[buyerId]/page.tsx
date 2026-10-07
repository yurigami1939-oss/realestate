import { FileSignature, Pencil } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { useTranslations } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { PhoneActions, PhoneText } from "@/components/crm/phone";
import { ExportButton } from "@/components/exports/export-button";
import { PortalAccessControl } from "@/components/portal/portal-access";
import { SaleStatusBadge } from "@/components/sales/badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDate } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { getBuyer, type BuyerDetail } from "@/server/buyers/queries";
import { getPortalAccess, type PortalAccess } from "@/server/portal/invitations";
import { listBuyerSales } from "@/server/sales/sale-queries";

import { DocumentsChecklist } from "./_components/documents-checklist";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/buyers/[buyerId]">): Promise<Metadata> {
  const ctx = await requirePermission("buyer:read");
  const buyer = await getBuyer(ctx, (await params).buyerId);
  return { title: buyer ? `${buyer.lastName} ${buyer.firstName}` : undefined };
}

export default async function BuyerPage({ params }: PageProps<"/[locale]/buyers/[buyerId]">) {
  const { locale, buyerId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("buyer:read");
  const buyer = await getBuyer(ctx, buyerId);
  if (!buyer) notFound();
  const t = await getTranslations("buyers");
  const tc = await getTranslations("common");
  const editable = can(ctx.roles, "buyer:update");
  const civility = buyer.civility ? `${t(`civility.${buyer.civility}`)} ` : "";
  const sales = can(ctx.roles, "sale:read") ? await listBuyerSales(ctx, buyer.id) : null;
  const ts = await getTranslations("sales");
  const tp = await getTranslations("privacy");
  const money = (v: bigint) => formatDZD(v, toLocale(locale));
  const portal = {
    access: (await getPortalAccess(ctx, [{ kind: "buyer", id: buyer.id }])).get(buyer.id) ?? null,
    editable: editable && can(ctx.roles, "portal:invite"),
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={`${civility}${buyer.lastName} ${buyer.firstName}`}
        badge={
          buyer.lastNameAr || buyer.firstNameAr ? (
            <span className="text-lg text-muted-foreground" dir="rtl" lang="ar">
              {[buyer.lastNameAr, buyer.firstNameAr].filter(Boolean).join(" ")}
            </span>
          ) : null
        }
        crumbs={[{ label: t("title"), href: "/buyers" }]}
        actions={
          <>
            {can(ctx.roles, "sale:create") ? (
              <Button asChild>
                <Link href={`/sales/new?buyerId=${buyer.id}`}>
                  <FileSignature data-icon="inline-start" />
                  {ts("reserve")}
                </Link>
              </Button>
            ) : null}
            {editable ? (
              <Button asChild variant="outline">
                <Link href={`/buyers/${buyer.id}/edit`}>
                  <Pencil data-icon="inline-start" />
                  {tc("edit")}
                </Link>
              </Button>
            ) : null}
            {can(ctx.roles, "personal_data:export") ? (
              <ExportButton kind="person" params={{ buyer: buyer.id }} label={tp("export")} />
            ) : null}
          </>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <IdentityCard buyer={buyer} />
        <ContactCard buyer={buyer} portal={portal} />
      </div>
      {sales && sales.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{ts("title")}</CardTitle>
          </CardHeader>
          <CardContent>
            <Table data-testid="buyer-sales">
              <TableBody>
                {sales.map((sale) => (
                  <TableRow key={sale.id}>
                    <TableCell>
                      <Link
                        href={`/sales/${sale.id}`}
                        className="font-medium tabular-nums hover:underline"
                        dir="ltr"
                      >
                        {sale.number}
                      </Link>
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      <bdi dir="ltr">{sale.unitCode}</bdi>
                      <span className="text-muted-foreground"> · {sale.projectName}</span>
                    </TableCell>
                    <TableCell>
                      <SaleStatusBadge status={sale.status} />
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(sale.price)}
                    </TableCell>
                    <TableCell className="tabular-nums" dir="ltr">
                      {formatDate(sale.reservedOn)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("documents.title")}</CardTitle>
          <Badge
            variant="outline"
            className={
              buyer.missingRequired > 0 ? "border-amber-400 text-amber-800" : "text-emerald-800"
            }
          >
            {t("documents.missing", { count: buyer.missingRequired })}
          </Badge>
        </CardHeader>
        <CardContent>
          <DocumentsChecklist buyerId={buyer.id} documents={buyer.documents} editable={editable} />
        </CardContent>
      </Card>
    </div>
  );
}

function Rows({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="space-y-2 text-sm">
      {rows.map(({ label, value }) => (
        <div key={label} className="flex justify-between gap-3 border-b pb-1.5">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-end font-medium">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function IdentityCard({ buyer }: { buyer: BuyerDetail }) {
  const t = useTranslations("buyers");
  return (
    <Card className="lg:col-span-2">
      <CardHeader>
        <CardTitle className="text-base">{t("sections.identity")}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        <Rows
          rows={[
            {
              label: t("fields.birthDate"),
              value: buyer.birthDate ? formatDate(buyer.birthDate) : null,
            },
            { label: t("fields.birthPlace"), value: buyer.birthPlace },
            { label: t("fields.fatherFirstName"), value: buyer.fatherFirstName },
            { label: t("fields.motherFullName"), value: buyer.motherFullName },
            {
              label: t("fields.maritalStatus"),
              value: buyer.maritalStatus ? t(`maritalStatus.${buyer.maritalStatus}`) : null,
            },
          ]}
        />
        <Rows
          rows={[
            {
              label: t("fields.nin"),
              value: buyer.nin ? (
                <bdi dir="ltr" className="tabular-nums">
                  {buyer.nin}
                </bdi>
              ) : null,
            },
            {
              label: t("fields.idCardNumber"),
              value: buyer.idCardNumber ? <bdi dir="ltr">{buyer.idCardNumber}</bdi> : null,
            },
            {
              label: t("fields.idCardIssuedOn"),
              value: buyer.idCardIssuedOn ? formatDate(buyer.idCardIssuedOn) : null,
            },
            { label: t("fields.idCardIssuedBy"), value: buyer.idCardIssuedBy },
            {
              label: t("fields.profession"),
              value: [buyer.profession, buyer.employer].filter(Boolean).join(" · ") || null,
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}

function ContactCard({
  buyer,
  portal,
}: {
  buyer: BuyerDetail;
  portal: { access: PortalAccess | null; editable: boolean };
}) {
  const t = useTranslations("buyers");
  const tp = useTranslations("portal.access");
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("sections.contact")}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <PhoneActions value={buyer.phone} />
        <Rows
          rows={[
            {
              label: t("fields.phone2"),
              value: buyer.phone2 ? <PhoneText value={buyer.phone2} /> : null,
            },
            {
              label: t("fields.email"),
              value: buyer.email ? (
                <a href={`mailto:${buyer.email}`} dir="ltr" className="hover:underline">
                  {buyer.email}
                </a>
              ) : null,
            },
            {
              label: t("fields.address"),
              value:
                [buyer.address, buyer.commune, buyer.wilaya].filter(Boolean).join(", ") || null,
            },
            { label: t("owner"), value: buyer.ownerName },
            {
              label: t("lead"),
              value:
                buyer.leadId && buyer.leadName ? (
                  <Link href={`/leads/${buyer.leadId}`} className="hover:underline">
                    {buyer.leadName}
                  </Link>
                ) : null,
            },
          ]}
        />
        {buyer.notes ? (
          <p className="text-sm whitespace-pre-line text-muted-foreground">{buyer.notes}</p>
        ) : null}
        <div className="space-y-2 border-t pt-3">
          <div className="text-sm font-medium">{tp("title")}</div>
          <PortalAccessControl
            target={{ kind: "buyer", id: buyer.id }}
            email={buyer.email}
            access={portal.access}
            editable={portal.editable}
          />
        </div>
      </CardContent>
    </Card>
  );
}
