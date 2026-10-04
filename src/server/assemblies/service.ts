import "server-only";

import { and, eq, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { assemblyResolution, generalAssembly } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { loadResidence } from "@/server/residences/service";

import type {
  addResolutionSchema,
  createAssemblySchema,
  updateAssemblySchema,
  updateResolutionSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** An assembly of the organization (locked); NOT_FOUND otherwise. */
export async function loadAssembly(tx: Tx, assemblyId: string) {
  const [row] = await tx
    .select()
    .from(generalAssembly)
    .where(eq(generalAssembly.id, assemblyId))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** The agenda and the meeting details change only before the convocation. */
function assertDraft(assembly: { status: string }) {
  if (assembly.status !== "draft") throw new AppError("CONFLICT", "assemblies.errors.notDraft");
}

/** New general assembly of a residence, as a draft (assembly:update). */
export async function createAssembly(ctx: TenantCtx, input: In<typeof createAssemblySchema>) {
  assertCan(ctx, "assembly:update");
  const { residenceId, ...fields } = input;
  return withTenant(ctx, async (tx) => {
    const home = await loadResidence(tx, residenceId);
    const [row] = await tx
      .insert(generalAssembly)
      .values({ ...fields, organizationId: ctx.orgId, residenceId: home.id, createdBy: ctx.userId })
      .returning({ id: generalAssembly.id });
    if (!row) throw new Error("createAssembly: no row returned");
    return { id: row.id };
  });
}

export async function updateAssembly(ctx: TenantCtx, input: In<typeof updateAssemblySchema>) {
  assertCan(ctx, "assembly:update");
  const { assemblyId, ...fields } = input;
  await withTenant(ctx, async (tx) => {
    assertDraft(await loadAssembly(tx, assemblyId));
    await tx.update(generalAssembly).set(fields).where(eq(generalAssembly.id, assemblyId));
  });
}

/** Adds a resolution at the end of the agenda (draft assemblies only). */
export async function addResolution(ctx: TenantCtx, input: In<typeof addResolutionSchema>) {
  assertCan(ctx, "assembly:update");
  const { assemblyId, ...fields } = input;
  return withTenant(ctx, async (tx) => {
    const assembly = await loadAssembly(tx, assemblyId);
    assertDraft(assembly);
    const [last] = await tx
      .select({ position: sql<number>`coalesce(max(${assemblyResolution.position}), 0)::int` })
      .from(assemblyResolution)
      .where(eq(assemblyResolution.assemblyId, assembly.id));
    const [row] = await tx
      .insert(assemblyResolution)
      .values({
        ...fields,
        organizationId: ctx.orgId,
        assemblyId: assembly.id,
        position: (last?.position ?? 0) + 1,
        createdBy: ctx.userId,
      })
      .returning({ id: assemblyResolution.id });
    if (!row) throw new Error("addResolution: no row returned");
    return { id: row.id };
  });
}

async function loadResolution(tx: Tx, resolutionId: string) {
  const [row] = await tx
    .select()
    .from(assemblyResolution)
    .where(eq(assemblyResolution.id, resolutionId))
    .for("update");
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

export async function updateResolution(ctx: TenantCtx, input: In<typeof updateResolutionSchema>) {
  assertCan(ctx, "assembly:update");
  const { resolutionId, ...fields } = input;
  await withTenant(ctx, async (tx) => {
    const current = await loadResolution(tx, resolutionId);
    assertDraft(await loadAssembly(tx, current.assemblyId));
    await tx.update(assemblyResolution).set(fields).where(eq(assemblyResolution.id, resolutionId));
  });
}

/** Removes a resolution from the agenda and renumbers the following ones. */
export async function deleteResolution(ctx: TenantCtx, resolutionId: string) {
  assertCan(ctx, "assembly:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadResolution(tx, resolutionId);
    assertDraft(await loadAssembly(tx, current.assemblyId));
    await tx.delete(assemblyResolution).where(eq(assemblyResolution.id, resolutionId));
    await tx
      .update(assemblyResolution)
      .set({ position: sql`${assemblyResolution.position} - 1` })
      .where(
        and(
          eq(assemblyResolution.assemblyId, current.assemblyId),
          sql`${assemblyResolution.position} > ${current.position}`,
        ),
      );
  });
}

/**
 * Convenes the assembly: the agenda is fixed and the bilingual convocation is rendered by the
 * worker. Needs at least one resolution.
 */
export async function conveneAssembly(ctx: TenantCtx, assemblyId: string) {
  assertCan(ctx, "assembly:update");
  await withTenant(ctx, async (tx) => {
    const assembly = await loadAssembly(tx, assemblyId);
    assertDraft(assembly);
    const [agenda] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assemblyResolution)
      .where(eq(assemblyResolution.assemblyId, assembly.id));
    if (!agenda?.n) throw new AppError("CONFLICT", "assemblies.errors.emptyAgenda");
    await tx
      .update(generalAssembly)
      .set({ status: "convened", convenedAt: new Date() })
      .where(eq(generalAssembly.id, assembly.id));
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "assembly_convocation", id: assembly.id },
      { singletonKey: `assembly_convocation:${assembly.id}` },
    );
  });
}
