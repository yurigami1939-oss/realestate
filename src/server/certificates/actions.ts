"use server";

import { revalidatePath } from "next/cache";

import { defineAction } from "@/server/action";

import { issueCertificateSchema } from "./schemas";
import { issueCertificate } from "./service";

export const issueCertificateAction = defineAction(
  { input: issueCertificateSchema, permission: "sale:certify" },
  async (input, ctx) => {
    const issued = await issueCertificate(ctx, input);
    revalidatePath(`/[locale]/sales/${input.reservationId}`, "page");
    return issued;
  },
);
