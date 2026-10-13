import { z } from "zod";

import { consoleDocumentFile } from "@/server/console/billing";
import { getOperatorCtx } from "@/server/console/guard";
import { presignDownload } from "@/server/files/storage";
import { toHttpError } from "@/server/route-handler";

/**
 * An operator invoice or credit note (CLAUDE.console.md §11), for operators only: a redirect to
 * a 5-minute presigned URL of its stored PDF.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/console/documents/[id]">,
) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  try {
    await getOperatorCtx();
    const file = await consoleDocumentFile(id);
    if (!file) return new Response(null, { status: 404 });
    const url = await presignDownload({
      ...file,
      contentType: "application/pdf",
      disposition: "inline",
    });
    return new Response(null, {
      status: 302,
      headers: { Location: url, "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return new Response(null, { status: toHttpError(error).status });
  }
}
