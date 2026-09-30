"use client";

import { useLocale, useTranslations } from "next-intl";
import { useTransition } from "react";

import { Button } from "@/components/ui/button";
import { locales } from "@/i18n/locales";
import { usePathname, useRouter } from "@/i18n/navigation";

export function LocaleSwitcher() {
  const current = useLocale();
  const t = useTranslations("locale");
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex gap-1" aria-label={t(current)}>
      {locales.map((locale) => (
        <Button
          key={locale}
          lang={locale}
          size="sm"
          variant={locale === current ? "secondary" : "ghost"}
          aria-pressed={locale === current}
          disabled={pending}
          onClick={() => startTransition(() => router.replace(pathname, { locale }))}
        >
          {t(locale)}
        </Button>
      ))}
    </div>
  );
}
