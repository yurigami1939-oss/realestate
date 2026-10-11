"use server";

import { headers } from "next/headers";

import { definePortalAction } from "@/server/portal/action";

import { requestSignatureCodeSchema, signDocumentSchema } from "./schemas";
import { requestSignatureCode, signDocument } from "./service";

export const requestSignatureCodeAction = definePortalAction(
  requestSignatureCodeSchema,
  (input, ctx) => requestSignatureCode(ctx, input),
);

export const signDocumentAction = definePortalAction(signDocumentSchema, async (input, ctx) => {
  const request = await headers();
  const forwarded = request.get("x-forwarded-for")?.split(",")[0]?.trim();
  return signDocument(ctx, input, {
    ip: forwarded || request.get("x-real-ip"),
    userAgent: request.get("user-agent"),
  });
});
