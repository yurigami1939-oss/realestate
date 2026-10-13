import { z } from "zod";

import { getTenantCtx } from "@/server/auth/session";
import { tenantInvoiceFile } from "@/server/entitlements/invoices";
import { presignDownload } from "@/server/files/storage";
import { toHttpError } from "@/server/route-handler";

/**
 * One of the account's invoices or credit notes (CLAUDE.console.md §11, `subscription:read`):
 * checked through `console.tenant_invoices()`, then a redirect to a 5-minute presigned URL.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext<"/api/subscription/invoices/[id]">,
) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return new Response(null, { status: 404 });
  try {
    const ctx = await getTenantCtx();
    const file = await tenantInvoiceFile(ctx, id);
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
