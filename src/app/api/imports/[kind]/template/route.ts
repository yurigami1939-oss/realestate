import { isLocale } from "@/i18n/locales";
import { getTenantCtx } from "@/server/auth/session";
import { importKinds } from "@/server/imports/schemas";
import { buildTemplate } from "@/server/imports/templates";
import { toHttpError } from "@/server/route-handler";

const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** The .xlsx template of an import, in the member's language (`?locale=fr|ar`). */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/imports/[kind]/template">,
) {
  const { kind } = await params;
  if (!(importKinds as readonly string[]).includes(kind))
    return new Response(null, { status: 404 });
  try {
    const ctx = await getTenantCtx();
    const locale = new URL(request.url).searchParams.get("locale");
    const { file, bytes } = await buildTemplate(
      kind as (typeof importKinds)[number],
      isLocale(locale) ? locale : ctx.locale,
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
