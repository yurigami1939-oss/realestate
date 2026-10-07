import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { LeaseForm } from "@/components/rentals/lease-form";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { toDecimalString } from "@/lib/money";
import { requirePermission } from "@/server/auth/page-guard";
import { getLease } from "@/server/rentals/queries";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("rentals");
  return { title: t("editTitle") };
}

/** Money as typed in amount inputs ("45000,00"); "" for zero optional amounts. */
const asInput = (v: bigint, optional = false) =>
  optional && v === 0n ? "" : toDecimalString(v).replace(".", ",");

/** Corrects an active lease: the tenant at any time, the terms while nothing is paid. */
export default async function EditLeasePage({
  params,
}: PageProps<"/[locale]/rentals/[leaseId]/edit">) {
  const { locale, leaseId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("lease:update");
  const lease = await getLease(ctx, leaseId);
  if (!lease || lease.status !== "active") notFound();
  const t = await getTranslations("rentals");
  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title={t("editTitle")}
        description={`${lease.number} · ${lease.unitCode}`}
        crumbs={[
          { label: t("title"), href: "/rentals" },
          { label: lease.number, href: `/rentals/${lease.id}` },
        ]}
      />
      <LeaseForm
        units={[]}
        today={todayInAlgiers()}
        lease={{
          id: lease.id,
          unitId: lease.unitId,
          kind: lease.kind,
          tenantName: lease.tenantName,
          tenantNameAr: lease.tenantNameAr ?? "",
          tenantIdNumber: lease.tenantIdNumber ?? "",
          tenantPhone: lease.tenantPhone,
          tenantWhatsappOptIn: lease.tenantWhatsappOptIn,
          tenantEmail: lease.tenantEmail ?? "",
          tenantAddress: lease.tenantAddress ?? "",
          activity: lease.activity ?? "",
          guarantorName: lease.guarantorName ?? "",
          guarantorIdNumber: lease.guarantorIdNumber ?? "",
          guarantorPhone: lease.guarantorPhone ?? "",
          guarantorAddress: lease.guarantorAddress ?? "",
          signedOn: lease.signedOn,
          startOn: lease.startOn,
          durationMonths: String(lease.durationMonths),
          monthlyRent: asInput(lease.monthlyRent),
          monthlyCharges: asInput(lease.monthlyCharges, true),
          frequency: lease.frequency,
          deposit: asInput(lease.deposit, true),
          notes: lease.notes ?? "",
        }}
      />
    </div>
  );
}
