import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { PageHeader } from "@/components/app-shell/page-header";
import { toLocale } from "@/i18n/locales";
import { toDecimalString } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { requirePermission } from "@/server/auth/page-guard";
import { getBuyer } from "@/server/buyers/queries";

import { BuyerForm } from "../../_components/buyer-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("buyers");
  return { title: t("editTitle") };
}

export default async function EditBuyerPage({
  params,
}: PageProps<"/[locale]/buyers/[buyerId]/edit">) {
  const { locale, buyerId } = await params;
  setRequestLocale(toLocale(locale));
  const ctx = await requirePermission("buyer:update");
  const b = await getBuyer(ctx, buyerId);
  if (!b) notFound();
  const t = await getTranslations("buyers");
  const text = (v: string | null) => v ?? "";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        title={t("editTitle")}
        crumbs={[
          { label: t("title"), href: "/buyers" },
          { label: `${b.lastName} ${b.firstName}`, href: `/buyers/${b.id}` },
        ]}
      />
      <BuyerForm
        buyerId={b.id}
        defaultValues={{
          civility: b.civility ?? "",
          lastName: b.lastName,
          firstName: b.firstName,
          lastNameAr: text(b.lastNameAr),
          firstNameAr: text(b.firstNameAr),
          birthDate: text(b.birthDate),
          birthPlace: text(b.birthPlace),
          fatherFirstName: text(b.fatherFirstName),
          motherFullName: text(b.motherFullName),
          nin: text(b.nin),
          idCardNumber: text(b.idCardNumber),
          idCardIssuedOn: text(b.idCardIssuedOn),
          idCardIssuedBy: text(b.idCardIssuedBy),
          phone: formatPhone(b.phone),
          phone2: b.phone2 ? formatPhone(b.phone2) : "",
          whatsappOptIn: b.whatsappOptIn,
          email: text(b.email),
          address: text(b.address),
          commune: text(b.commune),
          wilaya: text(b.wilaya),
          profession: text(b.profession),
          employer: text(b.employer),
          maritalStatus: b.maritalStatus ?? "",
          householdIncome:
            b.householdIncome === null ? "" : toDecimalString(b.householdIncome).replace(".", ","),
          ownsHome: b.ownsHome ?? false,
          previousHousingAid: b.previousHousingAid ?? false,
          notes: text(b.notes),
          leadId: "",
        }}
      />
    </div>
  );
}
