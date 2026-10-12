import { FlaskConical } from "lucide-react";
import { connection } from "next/server";
import { getTranslations } from "next-intl/server";

import { demoModeEnabled } from "@/server/demo";

/**
 * « Démo — données fictives, réinitialisées chaque nuit » above every page of the demo
 * deployment (CLAUDE.console.md §13), nothing elsewhere. Read per request: the demo runs the
 * same build as the real deployment.
 */
export async function DemoBanner() {
  await connection();
  if (!demoModeEnabled()) return null;
  const t = await getTranslations("demo");
  return (
    <div
      role="note"
      className="flex items-center justify-center gap-2 bg-info-soft px-4 py-1.5 text-center text-footnote font-medium text-info"
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      {t("banner")}
    </div>
  );
}
