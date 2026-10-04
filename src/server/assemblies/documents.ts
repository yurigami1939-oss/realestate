import "server-only";

import { asc, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import { assemblyResolution, generalAssembly, residence } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import {
  type AssemblyConvocationData,
  AssemblyConvocationTemplate,
} from "@/pdf/templates/assembly-convocation";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

/** Everything printed on an assembly's convocation (null if unknown or not convened). */
export async function loadConvocationData(
  tx: Tx,
  assemblyId: string,
): Promise<{ data: AssemblyConvocationData; fileId: string | null; residenceId: string } | null> {
  const [row] = await tx
    .select({
      assembly: generalAssembly,
      residenceName: residence.name,
      address: residence.address,
      commune: residence.commune,
      wilaya: residence.wilaya,
    })
    .from(generalAssembly)
    .innerJoin(residence, eq(residence.id, generalAssembly.residenceId))
    .where(eq(generalAssembly.id, assemblyId));
  if (!row?.assembly.convenedAt) return null;
  const agenda = await tx
    .select({
      position: assemblyResolution.position,
      title: assemblyResolution.title,
      titleAr: assemblyResolution.titleAr,
      majority: assemblyResolution.majority,
    })
    .from(assemblyResolution)
    .where(eq(assemblyResolution.assemblyId, assemblyId))
    .orderBy(asc(assemblyResolution.position));
  const a = row.assembly;
  return {
    fileId: a.convocationFileId,
    residenceId: a.residenceId,
    data: {
      residenceName: row.residenceName,
      residenceAddress: [row.address, row.commune, row.wilaya].filter(Boolean).join(", "),
      kind: a.kind,
      heldOn: a.heldOn,
      startTime: a.startTime,
      place: a.place,
      convenedAt: a.convenedAt ?? new Date(),
      agenda,
    },
  };
}

export function convocationHtml(data: AssemblyConvocationData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(AssemblyConvocationTemplate, { data, company }),
  )}`;
}

/** `pdf.document` (assembly_convocation): rendered once, filed under the residence. */
export async function renderAndStoreConvocation(
  organizationId: string,
  assemblyId: string,
): Promise<"stored" | "skipped"> {
  const scope = { orgId: organizationId };
  const loaded = await withTenant(scope, async (tx) => {
    const convocation = await loadConvocationData(tx, assemblyId);
    if (!convocation || convocation.fileId) return null;
    return { convocation, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const bytes = new Uint8Array(
    await renderPdf(convocationHtml(loaded.convocation.data, loaded.company)),
  );
  return withTenant(scope, async (tx) => {
    const [current] = await tx
      .select({ fileId: generalAssembly.convocationFileId })
      .from(generalAssembly)
      .where(eq(generalAssembly.id, assemblyId))
      .for("update");
    if (!current || current.fileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        entityType: "residence",
        entityId: loaded.convocation.residenceId,
        upload: {
          fileName: `convocation-ag-${loaded.convocation.data.heldOn}.pdf`,
          bytes,
        },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(generalAssembly)
      .set({ convocationFileId: stored.id })
      .where(eq(generalAssembly.id, assemblyId));
    return "stored";
  });
}
