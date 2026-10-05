/** Isomorphic: a project's regulatory file (CLAUDE.md §7 Promoter's obligations). */
import { z } from "zod";

import { projectDocumentKinds } from "@/lib/obligations";
import { optionalDateText, optionalText } from "@/lib/zod";

const documentFields = {
  kind: z.enum(projectDocumentKinds),
  title: optionalText(120),
  reference: optionalText(80),
  issuedOn: optionalDateText(),
  expiresOn: optionalDateText(),
  issuer: optionalText(120),
  notes: optionalText(500),
};

type DocumentFields = {
  kind: string;
  title: string | null;
  issuedOn: string | null;
  expiresOn: string | null;
};

/** « Autre » needs a title; a document cannot expire before it is issued. */
function checkDocument(value: DocumentFields, ctx: z.RefinementCtx) {
  if (value.kind === "other" && value.title === null) {
    ctx.addIssue({ code: "custom", path: ["title"], message: "validation.required" });
  }
  if (value.issuedOn && value.expiresOn && value.expiresOn < value.issuedOn) {
    ctx.addIssue({
      code: "custom",
      path: ["expiresOn"],
      message: "obligations.errors.expiresBeforeIssue",
    });
  }
}

export const createProjectDocumentSchema = z
  .object({ projectId: z.uuid(), ...documentFields })
  .superRefine(checkDocument);

export const updateProjectDocumentSchema = z
  .object({ documentId: z.uuid(), ...documentFields })
  .superRefine(checkDocument);

export const projectDocumentIdSchema = z.object({ documentId: z.uuid() });

/** The add / edit dialog's form: `targetId` is the project (add) or the document (edit). */
export const projectDocumentFormSchema = z
  .object({ targetId: z.uuid(), ...documentFields })
  .superRefine(checkDocument);
