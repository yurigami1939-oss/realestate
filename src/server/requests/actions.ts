"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { closePortalRequestSchema } from "./schemas";
import { closePortalRequest } from "./service";

export const closePortalRequestAction = defineAction(
  { input: closePortalRequestSchema, permission: "sale:read" },
  async (input, ctx) => {
    await closePortalRequest(ctx, input);
    for (const path of ["/[locale]/sales", "/[locale]/dashboard", "/[locale]/portal"]) {
      revalidatePath(path, "layout");
    }
  },
);
