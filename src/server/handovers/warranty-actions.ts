"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";
import { definePortalAction } from "@/server/portal/action";

import {
  assignWarrantyClaimSchema,
  fixWarrantyClaimSchema,
  portalWarrantyClaimSchema,
  rejectWarrantyClaimSchema,
  reportWarrantyClaimSchema,
} from "./schemas";
import {
  assignWarrantyClaim,
  fixWarrantyClaim,
  rejectWarrantyClaim,
  reportPortalWarrantyClaim,
  reportWarrantyClaim,
} from "./warranty";

/** Claims show on the delivery page, the dashboard and the buyer's portal. */
function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    for (const path of ["/[locale]/deliveries", "/[locale]/dashboard", "/[locale]/portal"]) {
      revalidatePath(path, "layout");
    }
    return result;
  });
}

export const reportWarrantyClaimAction = defineAction(
  { input: reportWarrantyClaimSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => reportWarrantyClaim(ctx, input)),
);
export const assignWarrantyClaimAction = defineAction(
  { input: assignWarrantyClaimSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => assignWarrantyClaim(ctx, input)),
);
export const fixWarrantyClaimAction = defineAction(
  { input: fixWarrantyClaimSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => fixWarrantyClaim(ctx, input)),
);
export const rejectWarrantyClaimAction = defineAction(
  { input: rejectWarrantyClaimSchema, permission: "handover:update" },
  (input, ctx) => mutation(() => rejectWarrantyClaim(ctx, input)),
);

/** A buyer reports a defect of their delivered unit from the portal. */
export const reportPortalWarrantyClaimAction = definePortalAction(
  portalWarrantyClaimSchema,
  (input, ctx) => mutation(() => reportPortalWarrantyClaim(ctx, input)),
);
