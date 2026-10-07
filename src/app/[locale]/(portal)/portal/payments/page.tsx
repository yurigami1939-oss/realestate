import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { OnlinePaymentStatusBadge, TestModeBadge } from "@/components/online-payments/badges";
import { Link } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { formatDateTime } from "@/lib/dates";
import { formatDZD } from "@/lib/money";
import { SATIM_HELP_NUMBER } from "@/lib/online-payments";
import { listPortalOnlinePayments } from "@/server/online-payments/queries";
import { requirePortalCtx } from "@/server/portal/page-guard";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.pay");
  return { title: t("history") };
}

/** The account's online payments, each with its result page. */
export default async function PortalOnlinePaymentsPage({
  params,
}: PageProps<"/[locale]/portal/payments">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requirePortalCtx();
  const payments = await listPortalOnlinePayments(ctx);
  const t = await getTranslations("portal.pay");

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("history")}</h1>
      {payments.length === 0 ? (
        <p className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          {t("historyEmpty")}
        </p>
      ) : (
        <ul
          className="divide-y rounded-lg border bg-background"
          data-testid="portal-online-payments"
        >
          {payments.map((p) => (
            <li
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
            >
              <div className="space-y-0.5">
                <Link href={`/portal/payments/${p.id}`} className="font-medium hover:underline">
                  <bdi dir="ltr">{formatDZD(p.amount, locale)}</bdi>
                  {" · "}
                  {`${(p.purpose === "charges" ? p.residenceName : p.projectName) ?? ""} · ${
                    p.unitCode ?? ""
                  }`}
                </Link>
                <div className="text-muted-foreground">
                  {formatDateTime(p.createdAt)} · {t("order", { number: p.orderNumber })}
                </div>
              </div>
              <div className="flex items-center gap-2">
                {p.environment === "test" ? <TestModeBadge /> : null}
                <OnlinePaymentStatusBadge status={p.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm text-muted-foreground">
        {t("result.help", { number: SATIM_HELP_NUMBER })}
      </p>
    </div>
  );
}
