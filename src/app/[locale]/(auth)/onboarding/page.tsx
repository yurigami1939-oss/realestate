import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { getSession } from "@/server/auth/session";
import { listUserOrganizations } from "@/server/organizations/queries";

import { CreateOrganizationForm } from "./create-organization-form";
import { OrganizationPicker } from "./organization-picker";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("title") };
}

export default async function OnboardingPage({ params }: PageProps<"/[locale]/onboarding">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in?next=/onboarding", locale });

  const organizations = await listUserOrganizations(session.user.id);

  return (
    <div className="space-y-6">
      {organizations.length > 0 ? <OrganizationPicker organizations={organizations} /> : null}
      <CreateOrganizationForm hasExisting={organizations.length > 0} />
    </div>
  );
}
