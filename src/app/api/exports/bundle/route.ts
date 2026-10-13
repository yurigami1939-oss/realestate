import { getTranslations } from "next-intl/server";

import { isLocale } from "@/i18n/locales";
import { getTenantCtx } from "@/server/auth/session";
import { buildExportBundle } from "@/server/exports/bundle";
import { toHttpError } from "@/server/route-handler";

/**
 * Every export of the organization in one zip, with the index of its files (CLAUDE.console.md
 * §17 step 10): `GET /api/exports/bundle?locale=fr|ar`, the gérant only, in every state.
 */
export async function GET(request: Request) {
  try {
    const ctx = await getTenantCtx();
    const query = new URL(request.url).searchParams.get("locale");
    const locale = isLocale(query) ? query : ctx.locale;
    const translate = await getTranslations({ locale });
    const { file, bytes } = await buildExportBundle(ctx, locale, (key, values) =>
      translate(key as Parameters<typeof translate>[0], values),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return new Response(null, { status: toHttpError(error).status });
  }
}
