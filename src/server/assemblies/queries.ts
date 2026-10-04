import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { assemblyResolution, generalAssembly, residence } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { assertCan, type TenantCtx } from "@/server/auth/session";

/** Assemblies of a residence, newest first, with their agenda size. */
export async function listAssemblies(ctx: TenantCtx, residenceId: string) {
  assertCan(ctx, "assembly:read");
  if (!isUuid(residenceId)) return [];
  return withTenant(ctx, async (tx) => {
    const rows = await tx
      .select({
        id: generalAssembly.id,
        kind: generalAssembly.kind,
        heldOn: generalAssembly.heldOn,
        startTime: generalAssembly.startTime,
        place: generalAssembly.place,
        status: generalAssembly.status,
      })
      .from(generalAssembly)
      .where(eq(generalAssembly.residenceId, residenceId))
      .orderBy(desc(generalAssembly.heldOn));
    const counts = await tx
      .select({ assemblyId: assemblyResolution.assemblyId, n: sql<number>`count(*)::int` })
      .from(assemblyResolution)
      .groupBy(assemblyResolution.assemblyId);
    return rows.map((r) => ({
      ...r,
      resolutions: counts.find((c) => c.assemblyId === r.id)?.n ?? 0,
    }));
  });
}

export type AssemblyRow = Awaited<ReturnType<typeof listAssemblies>>[number];

/** An assembly with its residence and agenda (in order). */
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
    const resolutions = await tx
      .select()
      .from(assemblyResolution)
      .where(eq(assemblyResolution.assemblyId, assemblyId))
      .orderBy(asc(assemblyResolution.position));
    return { ...row.assembly, residenceName: row.residenceName, resolutions };
  });
}

export type AssemblyDetail = NonNullable<Awaited<ReturnType<typeof getAssembly>>>;
export type ResolutionRow = AssemblyDetail["resolutions"][number];
