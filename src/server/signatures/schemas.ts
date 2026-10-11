import { z } from "zod";

import { signableDocuments } from "@/lib/signatures";

const document = { documentType: z.enum(signableDocuments), documentId: z.uuid() };

export const requestSignatureCodeSchema = z.object(document);

export const signDocumentSchema = z.object({
  ...document,
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "signatures.errors.codeFormat"),
});
