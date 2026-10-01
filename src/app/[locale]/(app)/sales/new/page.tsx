import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { todayInAlgiers } from "@/lib/dates";
import { can } from "@/lib/permissions";
import { requirePermission } from "@/server/auth/page-guard";
import { listBuyerOptions } from "@/server/buyers/queries";
import { getSalesSettings } from "@/server/organizations/settings";
import { listPaymentSetups } from "@/server/payment-plans/queries";
import { listReservableUnits } from "@/server/sales/queries";

import { ReservationForm } from "./_components/reservation-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("sales");
  return { title: t("newTitle") };
}

export default async function NewReservationPage({
  params,
  searchParams,
}: PageProps<"/[locale]/sales/new">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePermission("sale:create");
  const raw = await searchParams;
  const units = await listReservableUnits(ctx);
  const buyers = await listBuyerOptions(ctx);
  const setups = await listPaymentSetups(ctx);
  const { vspLimits, paymentCallDelayDays } = await getSalesSettings(ctx);
  const t = await getTranslations();

  const unitId = typeof raw.unitId === "string" ? raw.unitId : "";
  const buyerId = typeof raw.buyerId === "string" ? raw.buyerId : "";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title={t("sales.newTitle")}
        crumbs={[{ label: t("sales.title"), href: "/sales" }]}
      />
      {units.length === 0 ? (
        <p className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          {t("sales.noUnits")}
        </p>
      ) : (
        <ReservationForm
          units={units}
          buyers={buyers}
          setups={setups}
          vspLimits={vspLimits}
          canDiscount={can(ctx.roles, "sale:discount")}
          delayDays={paymentCallDelayDays}
          today={todayInAlgiers()}
          defaults={{
            unitId: units.some((u) => u.id === unitId) ? unitId : "",
            buyerId: buyers.some((b) => b.id === buyerId) ? buyerId : "",
          }}
        />
      )}
    </div>
  );
}
