import { getTranslations } from "next-intl/server";

import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

export default async function NotFound() {
  const t = await getTranslations();
  return (
    <main className="grid min-h-dvh place-items-center p-8 text-center">
      <div className="space-y-3">
        <h1 className="text-2xl font-semibold">{t("errors.notFoundTitle")}</h1>
        <p className="text-muted-foreground">{t("errors.notFoundText")}</p>
        <Button asChild variant="outline">
          <Link href="/">{t("common.backHome")}</Link>
        </Button>
      </div>
    </main>
  );
}
