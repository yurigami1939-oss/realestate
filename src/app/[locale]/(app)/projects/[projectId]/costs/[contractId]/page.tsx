import { Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { CostScan } from "@/components/costs/cost-scan";
import {
  AcceptContractDialog,
  ContractDialog,
  PayWorksInvoiceDialog,
  ReleaseRetentionDialog,
  TerminateContractDialog,
  WorksInvoiceDialog,
} from "@/components/costs/cost-dialogs";
import { ConfirmAction } from "@/components/forms/confirm-action";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toLocale } from "@/i18n/locales";
import { formatDate, todayInAlgiers } from "@/lib/dates";
import { formatDZD, toDecimalString } from "@/lib/money";
import { formatShare } from "@/lib/payment-plans";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { deleteContractAction, deleteWorksInvoiceAction } from "@/server/costs/actions";
import { getWorksContract, listContractorChoices } from "@/server/costs/queries";
import { listAccountChoices } from "@/server/treasury/queries";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/projects/[projectId]/costs/[contractId]">): Promise<Metadata> {
  const ctx = await requirePermission("cost:read");
  const contract = await getWorksContract(ctx, (await params).contractId);
  return { title: contract?.title };
}

const asInput = (v: bigint) => toDecimalString(v).replace(".", ",");

/**
 * A contract with a contractor: its progress invoices (situations) with retention and
 * payments, the réceptions and the retention released at the end.
 */
export default async function WorksContractPage({
  params,
}: PageProps<"/[locale]/projects/[projectId]/costs/[contractId]">) {
  const { locale: raw, projectId, contractId } = await params;
  const locale = toLocale(raw);
  setRequestLocale(locale);
  const ctx = await requirePermission("cost:read");
  const contract = await getWorksContract(ctx, contractId);
  if (!contract || contract.projectId !== projectId) notFound();
  const t = await getTranslations("costs");
  const ti = await getTranslations("inventory");
  const tc = await getTranslations("common");
  const tp = await getTranslations("payments");
  const money = (v: bigint) => formatDZD(v, locale);
  const today = todayInAlgiers();
  const open = contract.state === "active" || contract.state === "provisional";
  const canUpdate = can(ctx.roles, "cost:update");
  const canPay = can(ctx.roles, "cost:pay");
  const contractors = canUpdate && open ? await listContractorChoices(ctx) : [];
  const accounts = canPay ? await listAccountChoices(ctx) : [];
  const lastPosition = contract.invoices.at(-1)?.position;

  const facts: {
    key: "contractor" | "category" | "contractAmount" | "retention" | "signedOn" | "plannedEndOn";
    value: string;
  }[] = [
    { key: "contractor", value: contract.supplierName },
    { key: "category", value: t(`category.${contract.category}`) },
    { key: "contractAmount", value: money(contract.amount) },
    { key: "retention", value: formatShare(contract.retentionBp) },
    { key: "signedOn", value: formatDate(contract.signedOn) },
    {
      key: "plannedEndOn",
      value: contract.plannedEndOn ? formatDate(contract.plannedEndOn) : "—",
    },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={contract.title}
        crumbs={[
          { label: ti("projects.title"), href: "/projects" },
          { label: contract.projectName, href: `/projects/${projectId}` },
          { label: t("title"), href: `/projects/${projectId}/costs` },
        ]}
        badge={<Badge variant="outline">{t(`state.${contract.state}`)}</Badge>}
        actions={
          <>
            {canUpdate && open ? (
              <WorksInvoiceDialog
                contractId={contract.id}
                retentionBp={contract.retentionBp}
                today={today}
              />
            ) : null}
            {canUpdate && contract.state === "active" ? (
              <AcceptContractDialog contractId={contract.id} stage="provisional" today={today} />
            ) : null}
            {canUpdate && contract.state === "provisional" ? (
              <AcceptContractDialog contractId={contract.id} stage="final" today={today} />
            ) : null}
            {canPay &&
            contract.state === "final" &&
            !contract.retentionReleasedOn &&
            contract.retention > 0n ? (
              <ReleaseRetentionDialog
                contractId={contract.id}
                amount={contract.retention}
                today={today}
                accounts={accounts}
              />
            ) : null}
            {canUpdate && open ? (
              <ContractDialog
                contractId={contract.id}
                contractors={contractors}
                today={today}
                values={{
                  supplierId: contract.supplierId,
                  category: contract.category,
                  reference: contract.reference ?? "",
                  title: contract.title,
                  amount: asInput(contract.amount),
                  retention: formatShare(contract.retentionBp).replace(/\s*%$/, ""),
                  signedOn: contract.signedOn,
                  plannedEndOn: contract.plannedEndOn ?? "",
                  notes: contract.notes ?? "",
                }}
              />
            ) : null}
            {canUpdate && open ? (
              <TerminateContractDialog contractId={contract.id} today={today} />
            ) : null}
            {canUpdate && contract.invoices.length === 0 ? (
              <ConfirmAction
                action={deleteContractAction}
                input={{ contractId: contract.id }}
                label={tc("delete")}
                icon={<Trash2 data-icon="inline-start" />}
                title={t("contracts.deleteTitle")}
                description={t("contracts.deleteDescription")}
                confirmLabel={tc("delete")}
                successMessage={t("contracts.deleted")}
                redirectTo={`/projects/${projectId}/costs`}
                destructive
              />
            ) : null}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t("contracts.details")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <dl className="space-y-2">
              {facts.map((f) => (
                <div key={f.key} className="flex justify-between gap-3">
                  <dt className="text-muted-foreground">{t(`fields.${f.key}`)}</dt>
                  <dd className="text-end">{f.value}</dd>
                </div>
              ))}
            </dl>
            {contract.reference ? (
              <p className="text-muted-foreground">
                {t("fields.reference")} : <bdi dir="ltr">{contract.reference}</bdi>
              </p>
            ) : null}
            <CostScan
              kind="contract"
              entityId={contract.id}
              fileId={contract.scanFileId}
              editable={canUpdate}
            />
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">{t("contracts.progress")}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <dl className="grid gap-3 sm:grid-cols-4" data-testid="contract-totals">
              {(
                [
                  ["invoiced", contract.invoiced],
                  ["paid", contract.paid],
                  ["unpaid", contract.unpaid],
                  ["retention", contract.retentionHeld],
                ] as const
              ).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-muted-foreground">{t(`columns.${key}`)}</dt>
                  <dd className="font-semibold tabular-nums" dir="ltr">
                    {money(value)}
                  </dd>
                </div>
              ))}
            </dl>
            {contract.provisionalAcceptanceOn ? (
              <p>
                {t("acceptance.provisionalOn", {
                  date: formatDate(contract.provisionalAcceptanceOn),
                })}
              </p>
            ) : null}
            {contract.finalAcceptanceOn ? (
              <p>{t("acceptance.finalOn", { date: formatDate(contract.finalAcceptanceOn) })}</p>
            ) : null}
            {contract.terminatedOn ? (
              <p className="text-red-800">
                {t("contracts.terminatedOn", { date: formatDate(contract.terminatedOn) })}
              </p>
            ) : null}
            {contract.acceptanceNotes ? (
              <p className="whitespace-pre-line text-muted-foreground">
                {contract.acceptanceNotes}
              </p>
            ) : null}
            {contract.retentionReleasedOn && contract.retentionReleased !== null ? (
              <p className="text-emerald-800">
                {t("retention.releasedOn", {
                  amount: money(contract.retentionReleased),
                  date: formatDate(contract.retentionReleasedOn),
                })}
                {contract.retentionAccountName ? ` · ${contract.retentionAccountName}` : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("invoices.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          {contract.invoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("invoices.empty")}</p>
          ) : (
            <Table data-testid="works-invoices">
              <TableHeader>
                <TableRow>
                  <TableHead>{t("columns.situation")}</TableHead>
                  <TableHead>{t("fields.invoicedOn")}</TableHead>
                  <TableHead className="text-end">{t("fields.gross")}</TableHead>
                  <TableHead className="text-end">{t("columns.retention")}</TableHead>
                  <TableHead className="text-end">{t("columns.net")}</TableHead>
                  <TableHead>{t("columns.payment")}</TableHead>
                  <TableHead>
                    <span className="sr-only">{tc("actions")}</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contract.invoices.map((i) => (
                  <TableRow key={i.id} data-situation={i.position}>
                    <TableCell className="whitespace-normal">
                      {t("invoices.situation", { position: i.position })}
                      <span className="block text-xs text-muted-foreground">
                        {[i.number, i.label].filter(Boolean).join(" · ")}
                      </span>
                      <CostScan
                        kind="invoice"
                        entityId={i.id}
                        fileId={i.scanFileId}
                        editable={canUpdate}
                      />
                    </TableCell>
                    <TableCell className="tabular-nums" dir="ltr">
                      {formatDate(i.invoicedOn)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(i.gross)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(i.retention)}
                    </TableCell>
                    <TableCell className="text-end tabular-nums" dir="ltr">
                      {money(i.net)}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {i.paidOn ? (
                        <span className="text-emerald-800">
                          {t("invoices.paidOn", { date: formatDate(i.paidOn) })}
                          <span className="block text-xs text-muted-foreground">
                            {[
                              i.paymentMethod ? tp(`method.${i.paymentMethod}`) : null,
                              i.accountName,
                              i.paymentReference,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      ) : (
                        <span className="text-amber-800">
                          {i.dueOn
                            ? t("invoices.dueOn", { date: formatDate(i.dueOn) })
                            : t("invoices.unpaid")}
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap justify-end gap-1">
                        {!i.paidOn && canPay ? (
                          <PayWorksInvoiceDialog
                            invoiceId={i.id}
                            net={i.net}
                            today={today}
                            accounts={accounts}
                          />
                        ) : null}
                        {!i.paidOn && canUpdate ? (
                          <WorksInvoiceDialog
                            invoiceId={i.id}
                            retentionBp={contract.retentionBp}
                            today={today}
                            values={{
                              number: i.number ?? "",
                              invoicedOn: i.invoicedOn,
                              dueOn: i.dueOn ?? "",
                              label: i.label ?? "",
                              gross: asInput(i.gross),
                            }}
                          />
                        ) : null}
                        {!i.paidOn && canUpdate && i.position === lastPosition ? (
                          <ConfirmAction
                            action={deleteWorksInvoiceAction}
                            input={{ invoiceId: i.id }}
                            label={tc("delete")}
                            icon={<Trash2 />}
                            title={t("invoices.deleteTitle")}
                            description={t("invoices.deleteDescription")}
                            confirmLabel={tc("delete")}
                            successMessage={t("invoices.deleted")}
                            variant="ghost"
                            size="icon"
                            destructive
                          />
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <TableFooter>
                <TableRow>
                  <TableCell colSpan={2}>{t("columns.total")}</TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(contract.invoiced)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(contract.retention)}
                  </TableCell>
                  <TableCell className="text-end tabular-nums" dir="ltr">
                    {money(contract.invoiced - contract.retention)}
                  </TableCell>
                  <TableCell colSpan={2} />
                </TableRow>
              </TableFooter>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
