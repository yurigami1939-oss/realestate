import "server-only";

import { eq } from "drizzle-orm";
import type { z } from "zod";

import { chargeCall } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import type { requestChargeDocumentSchema } from "./schemas";

type DocumentRequest = z.output<typeof requestChargeDocumentSchema>;

/** Current PDF of a residence document, or undefined if unknown. */
async function currentPdf(
  ctx: TenantCtx,
  { kind, id }: DocumentRequest,
): Promise<{ pdfFileId: string | null } | undefined> {
  switch (kind) {
    case "charge_call":
      return withTenant(ctx, async (tx) => {
        const [row] = await tx
          .select({ pdfFileId: chargeCall.pdfFileId })
          .from(chargeCall)
          .where(eq(chargeCall.id, id));
        return row;
      });
  }
}

/** Requests a residence document's PDF again when it is still missing (idempotent job). */
export async function requestChargeDocument(ctx: TenantCtx, input: DocumentRequest) {
  assertCan(ctx, "charge:read");
  const current = await currentPdf(ctx, input);
  if (!current) throw new AppError("NOT_FOUND");
  if (current.pdfFileId) return;
  await withTenant(ctx, (tx) =>
    enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: input.kind, id: input.id },
      { singletonKey: `${input.kind}:${input.id}` },
    ),
  );
}
