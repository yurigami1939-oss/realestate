import "server-only";

import { asc, eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import type { Tx } from "@/db/client";
import {
  assemblyAttendance,
  assemblyResolution,
  assemblyVote,
  generalAssembly,
  residence,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { renderPdf } from "@/pdf/render";
import {
  type AssemblyConvocationData,
  AssemblyConvocationTemplate,
} from "@/pdf/templates/assembly-convocation";
import {
  type AssemblyMinutesData,
  AssemblyMinutesTemplate,
} from "@/pdf/templates/assembly-minutes";
import { storeFile } from "@/server/files/service";
import { type CompanyIdentity, loadCompanyLetterhead } from "@/server/organizations/settings";

/** The assembly with its residence's name and address. */
async function loadAssemblyHeader(tx: Tx, assemblyId: string) {
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
  if (!row) return null;
  return {
    assembly: row.assembly,
    residenceName: row.residenceName,
    residenceAddress: [row.address, row.commune, row.wilaya].filter(Boolean).join(", "),
  };
}

/** Everything printed on an assembly's convocation (null if unknown or not convened). */
export async function loadConvocationData(
  tx: Tx,
  assemblyId: string,
): Promise<{ data: AssemblyConvocationData; fileId: string | null; residenceId: string } | null> {
  const header = await loadAssemblyHeader(tx, assemblyId);
  if (!header?.assembly.convenedAt) return null;
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
  const a = header.assembly;
  return {
    fileId: a.convocationFileId,
    residenceId: a.residenceId,
    data: {
      residenceName: header.residenceName,
      residenceAddress: header.residenceAddress,
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

/** Everything printed on a closed assembly's minutes (null if unknown or not closed). */
export async function loadMinutesData(
  tx: Tx,
  assemblyId: string,
): Promise<{ data: AssemblyMinutesData; fileId: string | null; residenceId: string } | null> {
  const header = await loadAssemblyHeader(tx, assemblyId);
  const a = header?.assembly;
  if (!header || !a || a.status !== "closed" || a.totalShares === null) return null;
  const attendance = await tx
    .select({
      unitId: assemblyAttendance.unitId,
      unitCode: unit.code,
      coOwnerName: assemblyAttendance.coOwnerName,
      kind: assemblyAttendance.kind,
      proxyName: assemblyAttendance.proxyName,
      share: assemblyAttendance.share,
    })
    .from(assemblyAttendance)
    .innerJoin(unit, eq(unit.id, assemblyAttendance.unitId))
    .where(eq(assemblyAttendance.assemblyId, assemblyId))
    .orderBy(asc(unit.code));
  const resolutions = await tx
    .select()
    .from(assemblyResolution)
    .where(eq(assemblyResolution.assemblyId, assemblyId))
    .orderBy(asc(assemblyResolution.position));
  const votes = await tx
    .select({
      resolutionId: assemblyVote.resolutionId,
      unitId: assemblyVote.unitId,
      choice: assemblyVote.choice,
    })
    .from(assemblyVote)
    .where(eq(assemblyVote.assemblyId, assemblyId));
  /** "A-03-02 (Benali Omar)", in unit order. */
  const voters = (resolutionId: string, choice: "against" | "abstain") =>
    attendance
      .filter((u) =>
        votes.some(
          (v) => v.resolutionId === resolutionId && v.unitId === u.unitId && v.choice === choice,
        ),
      )
      .map((u) => (u.coOwnerName ? `${u.unitCode} (${u.coOwnerName})` : u.unitCode));
  return {
    fileId: a.minutesFileId,
    residenceId: a.residenceId,
    data: {
      residenceName: header.residenceName,
      residenceAddress: header.residenceAddress,
      kind: a.kind,
      heldOn: a.heldOn,
      startTime: a.startTime,
      endTime: a.endTime,
      place: a.place,
      convenedAt: a.convenedAt ?? a.closedAt ?? new Date(),
      chairName: a.chairName,
      secretaryName: a.secretaryName,
      totalShares: a.totalShares,
      attendance,
      resolutions: resolutions.map((r) => ({
        position: r.position,
        title: r.title,
        titleAr: r.titleAr,
        description: r.description,
        majority: r.majority,
        for: r.sharesFor ?? 0,
        against: r.sharesAgainst ?? 0,
        abstain: r.sharesAbstain ?? 0,
        adopted: r.adopted ?? false,
        opponents: voters(r.id, "against"),
        abstainers: voters(r.id, "abstain"),
      })),
    },
  };
}

export function minutesHtml(data: AssemblyMinutesData, company: CompanyIdentity): string {
  return `<!doctype html>${renderToStaticMarkup(
    createElement(AssemblyMinutesTemplate, { data, company }),
  )}`;
}

/** Links a rendered assembly document, filed under the residence, unless already linked. */
async function storeAssemblyPdf(
  organizationId: string,
  assemblyId: string,
  column: "convocationFileId" | "minutesFileId",
  file: { residenceId: string; fileName: string; bytes: Uint8Array },
): Promise<"stored" | "skipped"> {
  return withTenant({ orgId: organizationId }, async (tx) => {
    const [current] = await tx
      .select({ fileId: generalAssembly[column] })
      .from(generalAssembly)
      .where(eq(generalAssembly.id, assemblyId))
      .for("update");
    if (!current || current.fileId) return "skipped";
    const stored = await storeFile(
      tx,
      { orgId: organizationId, userId: null },
      {
        entityType: "residence",
        entityId: file.residenceId,
        upload: { fileName: file.fileName, bytes: file.bytes },
        contentType: "application/pdf",
      },
    );
    await tx
      .update(generalAssembly)
      .set(
        column === "convocationFileId"
          ? { convocationFileId: stored.id }
          : { minutesFileId: stored.id },
      )
      .where(eq(generalAssembly.id, assemblyId));
    return "stored";
  });
}

/** `pdf.document` (assembly_convocation): rendered once, filed under the residence. */
export async function renderAndStoreConvocation(
  organizationId: string,
  assemblyId: string,
): Promise<"stored" | "skipped"> {
  const loaded = await withTenant({ orgId: organizationId }, async (tx) => {
    const convocation = await loadConvocationData(tx, assemblyId);
    if (!convocation || convocation.fileId) return null;
    return { convocation, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const { data, residenceId } = loaded.convocation;
  const bytes = new Uint8Array(await renderPdf(convocationHtml(data, loaded.company)));
  return storeAssemblyPdf(organizationId, assemblyId, "convocationFileId", {
    residenceId,
    fileName: `convocation-ag-${data.heldOn}.pdf`,
    bytes,
  });
}

/** `pdf.document` (assembly_minutes): the minutes, rendered once at closing. */
export async function renderAndStoreMinutes(
  organizationId: string,
  assemblyId: string,
): Promise<"stored" | "skipped"> {
  const loaded = await withTenant({ orgId: organizationId }, async (tx) => {
    const minutes = await loadMinutesData(tx, assemblyId);
    if (!minutes || minutes.fileId) return null;
    return { minutes, company: await loadCompanyLetterhead(tx, organizationId) };
  });
  if (!loaded) return "skipped";
  const { data, residenceId } = loaded.minutes;
  const bytes = new Uint8Array(await renderPdf(minutesHtml(data, loaded.company)));
  return storeAssemblyPdf(organizationId, assemblyId, "minutesFileId", {
    residenceId,
    fileName: `pv-ag-${data.heldOn}.pdf`,
    bytes,
  });
}
