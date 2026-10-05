import { getTranslations } from "next-intl/server";

import { isLocale } from "@/i18n/locales";
import { getTenantCtx } from "@/server/auth/session";
import { exportKinds } from "@/server/exports/schemas";
import { buildExport } from "@/server/exports/service";
import { toHttpError } from "@/server/route-handler";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Spreadsheet exports (CLAUDE.md §5): `GET /api/exports/{kind}?filters&locale=fr|ar` → an .xlsx
 * attachment, built with the member's rights; errors answer their HTTP status.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/exports/[kind]">) {
  const { kind } = await params;
  if (!(exportKinds as readonly string[]).includes(kind))
    return new Response(null, { status: 404 });
  try {
    const ctx = await getTenantCtx();
    const query = Object.fromEntries(new URL(request.url).searchParams);
    const locale = isLocale(query.locale) ? query.locale : ctx.locale;
    const translate = await getTranslations({ locale });
    const { file, bytes } = await buildExport(
      ctx,
      kind as (typeof exportKinds)[number],
      query,
      locale,
      (key, values) => translate(key as Parameters<typeof translate>[0], values),
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": XLSX,
        "Content-Disposition": `attachment; filename="${file}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return new Response(null, { status: toHttpError(error).status });
  }
}
