import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { env } from "@/env";
import { redirect } from "@/i18n/navigation";
import { toLocale } from "@/i18n/locales";
import { OPERATOR_ROLE } from "@/server/auth/schema-options";
import { getSession } from "@/server/auth/session";
import { findLiveProvision } from "@/server/console/provisions";
import { listUserOrganizations } from "@/server/organizations/queries";

import { CreateOrganizationForm } from "./create-organization-form";
import { OrganizationPicker } from "./organization-picker";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("onboarding");
  return { title: t("title") };
}

/**
 * The company's creation (CLAUDE.console.md §8): from a provision link sent to the signed-in
 * e-mail, else only with OPEN_SIGNUP (local work); the user's companies are listed above.
 */
export default async function OnboardingPage({
  params,
  searchParams,
}: PageProps<"/[locale]/onboarding">) {
  const locale = toLocale((await params).locale);
  setRequestLocale(locale);

  const session = await getSession();
  if (!session) return redirect({ href: "/sign-in?next=/onboarding", locale });
  if ((session.user as { role?: string | null }).role === OPERATOR_ROLE) {
    return redirect({ href: "/console", locale });
  }

  const organizations = await listUserOrganizations(session.user.id);
  const token = (await searchParams).provision;
  const provision = typeof token === "string" ? await findLiveProvision(token) : null;
  const t = await getTranslations("onboarding");
  const notice = (title: string, text: string) => (
    <Card>
      <CardHeader>
        <CardTitle>
          <h1>{title}</h1>
        </CardTitle>
        <CardDescription>{text}</CardDescription>
      </CardHeader>
    </Card>
  );

  let create: React.ReactNode;
  if (typeof token === "string") {
    if (!provision) create = notice(t("closedTitle"), t("provision.invalid"));
    else if (provision.email !== session.user.email.trim().toLowerCase()) {
      create = notice(t("closedTitle"), t("provision.wrongEmail", { email: provision.email }));
    } else {
      create = (
        <CreateOrganizationForm
          hasExisting={organizations.length > 0}
          provision={{ token, legalName: provision.legalName }}
        />
      );
    }
  } else if (env.OPEN_SIGNUP === true) {
    create = <CreateOrganizationForm hasExisting={organizations.length > 0} />;
  } else {
    create = organizations.length > 0 ? null : notice(t("closedTitle"), t("closedText"));
  }

  return (
    <div className="space-y-6">
      {organizations.length > 0 ? <OrganizationPicker organizations={organizations} /> : null}
      {create}
    </div>
  );
}
