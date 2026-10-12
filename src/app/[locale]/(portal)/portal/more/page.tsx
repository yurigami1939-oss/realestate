import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { LocaleSwitcher } from "@/components/i18n/locale-switcher";
import { PortalRows } from "@/components/portal/portal-rows";
import { toLocale } from "@/i18n/locales";
import { requirePortalCtx } from "@/server/portal/page-guard";
import { portalNavSections } from "@/server/portal/sections";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("portal.more");
  return { title: t("title") };
}

/** « Plus » on phones (CLAUDE.md §14 item 17): every section, the language and signing out. */
export default async function PortalMorePage({ params }: PageProps<"/[locale]/portal/more">) {
  setRequestLocale(toLocale((await params).locale));
  const ctx = await requirePortalCtx();
  const sections = await portalNavSections(ctx);
  const t = await getTranslations("portal");
  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div className="space-y-1">
        <h1 className="text-large-title">{t("more.title")}</h1>
        <p className="text-muted-foreground">{t("more.description")}</p>
      </div>
      <PortalRows
        rows={sections
          .filter((s) => s.key !== "home")
          .map((s) => ({ key: s.key, href: s.href, icon: s.key, title: t(`shell.nav.${s.key}`) }))}
      />
      <section className="space-y-2">
        <h2 className="px-4 text-footnote font-semibold text-muted-foreground">
          {t("shell.nav.account")}
        </h2>
        <div className="space-y-4 rounded-xl bg-card p-4 shadow-card">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm">{t("shell.nav.language")}</span>
            <LocaleSwitcher />
          </div>
          <SignOutButton />
        </div>
      </section>
    </div>
  );
}
