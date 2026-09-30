import { z } from "zod";

import { getTenantCtx } from "@/server/auth/session";
import { getFileDownloadUrl } from "@/server/files/service";
import { toHttpError } from "@/server/route-handler";

/**
 * Download (CLAUDE.md §5 Files): permission check, then a redirect to a 5-minute presigned URL.
 * `?download` asks for an attachment; otherwise the browser shows the file inline.
 */
export async function GET(request: Request, { params }: RouteContext<"/api/files/[fileId]">) {
  const { fileId } = await params;
  if (!z.uuid().safeParse(fileId).success) return new Response(null, { status: 404 });
  try {
    const ctx = await getTenantCtx();
    const download = new URL(request.url).searchParams.has("download");
    const url = await getFileDownloadUrl(ctx, fileId, download ? "attachment" : "inline");
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return new Response(null, { status: toHttpError(error).status });
  }
}
