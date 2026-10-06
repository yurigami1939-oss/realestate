"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { createPartnerSchema, payPartnerCommissionSchema, updatePartnerSchema } from "./schemas";
import { createPartner, payPartnerCommission, updatePartner } from "./service";

function mutation<T>(run: () => Promise<T>): Promise<T> {
  return run().then((result) => {
    for (const path of ["/[locale]/partners", "/[locale]/leads", "/[locale]/treasury"]) {
      revalidatePath(path, "layout");
    }
    return result;
  });
}

export const createPartnerAction = defineAction(
  { input: createPartnerSchema, permission: "lead:assign" },
  (input, ctx) => mutation(() => createPartner(ctx, input)),
);
export const updatePartnerAction = defineAction(
  { input: updatePartnerSchema, permission: "lead:assign" },
  (input, ctx) => mutation(() => updatePartner(ctx, input)),
);
export const payPartnerCommissionAction = defineAction(
  { input: payPartnerCommissionSchema, permission: "commission:update" },
  (input, ctx) => mutation(() => payPartnerCommission(ctx, input)),
);
