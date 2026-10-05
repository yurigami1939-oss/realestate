import { date, foreignKey, index, pgEnum, pgTable, text, unique, uuid } from "drizzle-orm/pg-core";

import { projectDocumentKinds } from "../../lib/obligations";

import { id, organizationId, softDelete, timestamps } from "./_columns";
import { file } from "./files";
import { project } from "./inventory";

export const projectDocumentKind = pgEnum("project_document_kind", projectDocumentKinds);

/**
 * A document of a project's regulatory file (titre foncier, permis de construire, convention
 * CTC, assurance, attestation FGCMPI, certificat de conformité…): reference, issue and expiry
 * days, issuer, scan. Expired or expiring documents are flagged.
 */
export const projectDocument = pgTable(
  "project_document",
  {
    id: id(),
    organizationId: organizationId(),
    projectId: uuid().notNull(),
    kind: projectDocumentKind().notNull(),
    /** Free title for `other`, or a precision (e.g. « Permis modificatif »). */
    title: text(),
    reference: text(),
    issuedOn: date({ mode: "string" }),
    expiresOn: date({ mode: "string" }),
    issuer: text(),
    notes: text(),
    scanFileId: uuid(),
    ...timestamps(),
    ...softDelete(),
  },
  (t) => [
    unique().on(t.organizationId, t.id),
    foreignKey({
      name: "project_document_project_fk",
      columns: [t.organizationId, t.projectId],
      foreignColumns: [project.organizationId, project.id],
    }),
    foreignKey({
      name: "project_document_scan_fk",
      columns: [t.organizationId, t.scanFileId],
      foreignColumns: [file.organizationId, file.id],
    }),
    index().on(t.organizationId, t.projectId),
  ],
);
