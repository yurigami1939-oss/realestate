import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import {
  assemblyAttendance,
  assemblyResolution,
  assemblyVote,
  generalAssembly,
  residence,
  residenceUnit,
  unit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { AttendanceKind } from "@/lib/assemblies";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { mainCoOwners } from "@/server/charges/calls";

/** Assemblies of a residence, newest first, with their agenda size. */
export async function listAssemblies(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "assembly:read");
  if (!isUuid(residenceId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: generalAssembly.id,
        kind: generalAssembly.kind,
        heldOn: generalAssembly.heldOn,
        startTime: generalAssembly.startTime,
        place: generalAssembly.place,
        status: generalAssembly.status,
        // Qualified by hand: an unqualified "id" would be the subquery's own column.
        resolutions: sql<number>`(select count(*)::int from assembly_resolution r
          where r.assembly_id = general_assembly.id)`,
        adopted: sql<number>`(select count(*)::int from assembly_resolution r
          where r.assembly_id = general_assembly.id and r.adopted)`,
      })
      .from(generalAssembly)
      .where(eq(generalAssembly.residenceId, residenceId))
      .orderBy(desc(generalAssembly.heldOn), desc(generalAssembly.createdAt)),
  );
}

export type AssemblyRow = Awaited<ReturnType<typeof listAssemblies>>[number];

/**
 * An assembly with its residence, agenda (in order), attendance sheet and votes. Until the
 * assembly closes, the sheet lists the residence's units with their current tantièmes and main
 * co-owner on the meeting day, with the presence recorded so far; once closed, the frozen sheet.
 */
export async function getAssembly(ctx: TenantCtx, residenceId: string, assemblyId: string) {
  assertCan(ctx, "assembly:read");
  if (!isUuid(assemblyId) || !isUuid(residenceId)) return null;
  return withTenant(ctx, async (tx) => {
    const [row] = await tx
      .select({ assembly: generalAssembly, residenceName: residence.name })
      .from(generalAssembly)
      .innerJoin(residence, eq(residence.id, generalAssembly.residenceId))
      .where(and(eq(generalAssembly.id, assemblyId), eq(generalAssembly.residenceId, residenceId)));
    if (!row) return null;
    const { assembly } = row;
    const resolutions = await tx
      .select()
      .from(assemblyResolution)
      .where(eq(assemblyResolution.assemblyId, assemblyId))
      .orderBy(asc(assemblyResolution.position));
    const recorded = await tx
      .select({
        unitId: assemblyAttendance.unitId,
        code: unit.code,
        kind: assemblyAttendance.kind,
        coOwnerName: assemblyAttendance.coOwnerName,
        proxyName: assemblyAttendance.proxyName,
        share: assemblyAttendance.share,
      })
      .from(assemblyAttendance)
      .innerJoin(unit, eq(unit.id, assemblyAttendance.unitId))
      .where(eq(assemblyAttendance.assemblyId, assemblyId))
      .orderBy(asc(unit.code));
    type SheetRow = {
      unitId: string;
      code: string;
      share: number;
      coOwnerName: string | null;
      /** Null: not recorded yet. */
      kind: AttendanceKind | null;
      proxyName: string | null;
    };
    let sheet: SheetRow[] = recorded;
    if (assembly.status !== "closed") {
      const units = await tx
        .select({ unitId: residenceUnit.unitId, code: unit.code, share: residenceUnit.share })
        .from(residenceUnit)
        .innerJoin(unit, eq(unit.id, residenceUnit.unitId))
        .where(eq(residenceUnit.residenceId, residenceId))
        .orderBy(asc(unit.code));
      const owners = await mainCoOwners(tx, residenceId, assembly.heldOn);
      sheet = units.map((u) => {
        const taken = recorded.find((r) => r.unitId === u.unitId);
        const owner = owners.get(u.unitId);
        return {
          ...u,
          coOwnerName: owner ? `${owner.lastName} ${owner.firstName}` : null,
          kind: taken?.kind ?? null,
          proxyName: taken?.proxyName ?? null,
        };
      });
    }
    const votes = await tx
      .select({
        resolutionId: assemblyVote.resolutionId,
        unitId: assemblyVote.unitId,
        choice: assemblyVote.choice,
      })
      .from(assemblyVote)
      .where(eq(assemblyVote.assemblyId, assemblyId));
    return {
      ...assembly,
      residenceName: row.residenceName,
      resolutions,
      sheet,
      attendanceRecorded: recorded.length > 0,
      votes,
      /** Frozen at closing; until then, the tantièmes of the sheet. */
      shares: assembly.totalShares ?? sheet.reduce((sum, u) => sum + u.share, 0),
    };
  });
}

export type AssemblyDetail = NonNullable<Awaited<ReturnType<typeof getAssembly>>>;
export type ResolutionRow = AssemblyDetail["resolutions"][number];
export type AttendanceRow = AssemblyDetail["sheet"][number];
