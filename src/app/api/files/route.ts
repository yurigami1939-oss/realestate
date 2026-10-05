import { revalidatePath } from "next/cache";
import { z } from "zod";

import { MAX_UPLOAD_BYTES, uploadPurposeNames } from "@/lib/files";
import { AppError } from "@/lib/result";
import { buyerDocumentKinds } from "@/lib/sales";
import { getTenantCtx } from "@/server/auth/session";
import { setBuyerDocumentScan } from "@/server/buyers/service";
import { addReportPhoto } from "@/server/construction/service";
import { setUnitFloorPlan } from "@/server/inventory/floor-plans";
import { setCompanyLogo } from "@/server/organizations/settings";
import { setLeaseContractScan } from "@/server/rentals/service";
import { setReservationScan } from "@/server/sales/reservations";
import { assertSameOrigin, jsonResult, readFormData } from "@/server/route-handler";

const uploadFields = z.object({
  purpose: z.enum(uploadPurposeNames),
  entityId: z.uuid(),
  /** Purpose-specific detail, e.g. the document kind of a buyer scan. */
  variant: z.string().max(40).nullable(),
});

/** Room for the multipart boundaries and the text fields around the file. */
const FORM_OVERHEAD_BYTES = 64 * 1024;

/**
 * Upload (CLAUDE.md §5 Files): multipart `purpose`, `entityId`, `file` → `Result<{ fileId }>`.
 * The purpose's service checks the permission, the size and the real format.
 */
export async function POST(request: Request) {
  return jsonResult(async () => {
    assertSameOrigin(request);
    const ctx = await getTenantCtx();
    const form = await readFormData(request, MAX_UPLOAD_BYTES + FORM_OVERHEAD_BYTES);
    const fields = uploadFields.safeParse({
      purpose: form.get("purpose"),
      entityId: form.get("entityId"),
      variant: form.get("variant"),
    });
    if (!fields.success) throw new AppError("VALIDATION");
    const blob = form.get("file");
    if (!(blob instanceof File)) {
      throw new AppError("VALIDATION", "files.errors.empty", {
        fieldErrors: { file: ["files.errors.empty"] },
      });
    }
    const upload = { fileName: blob.name, bytes: new Uint8Array(await blob.arrayBuffer()) };

    switch (fields.data.purpose) {
      case "unit.floor_plan": {
        const result = await setUnitFloorPlan(ctx, { unitId: fields.data.entityId, upload });
        revalidatePath("/[locale]/projects", "layout");
        return result;
      }
      case "reservation.contract":
      case "reservation.deed": {
        const result = await setReservationScan(ctx, {
          reservationId: fields.data.entityId,
          kind: fields.data.purpose === "reservation.contract" ? "contract" : "deed",
          upload,
        });
        revalidatePath("/[locale]/sales", "layout");
        return result;
      }
      case "organization.logo": {
        // The logo belongs to the member's organization only.
        if (fields.data.entityId !== ctx.orgId) throw new AppError("NOT_FOUND");
        const result = await setCompanyLogo(ctx, { upload });
        revalidatePath("/[locale]/settings/company", "page");
        return result;
      }
      case "lease.contract": {
        const result = await setLeaseContractScan(ctx, {
          leaseId: fields.data.entityId,
          upload,
        });
        revalidatePath("/[locale]/rentals", "layout");
        return result;
      }
      case "construction_report.photo": {
        const result = await addReportPhoto(ctx, { reportId: fields.data.entityId, upload });
        revalidatePath("/[locale]/construction", "layout");
        return result;
      }
      case "buyer.document": {
        const kind = z.enum(buyerDocumentKinds).safeParse(fields.data.variant);
        if (!kind.success) throw new AppError("VALIDATION");
        const result = await setBuyerDocumentScan(ctx, {
          buyerId: fields.data.entityId,
          kind: kind.data,
          upload,
        });
        revalidatePath("/[locale]/buyers", "layout");
        return result;
      }
    }
  });
}
