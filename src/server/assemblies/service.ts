import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  assemblyAttendance,
  assemblyResolution,
  assemblyVote,
  generalAssembly,
  residenceUnit,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { isAdopted, tallyVotes, votingKinds } from "@/lib/assemblies";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { mainCoOwners } from "@/server/charges/calls";
import { loadResidence } from "@/server/residences/service";

import type {
  addResolutionSchema,
  closeAssemblySchema,
  createAssemblySchema,
  saveAttendanceSchema,
  saveVotesSchema,
  updateAssemblySchema,
  updateResolutionSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

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

/** Attendance and votes are recorded between the convocation and the closing. */
function assertConvened(assembly: { status: string }) {
  if (assembly.status === "draft") {
    throw new AppError("CONFLICT", "assemblies.errors.notConvened");
  }
  if (assembly.status === "closed") throw new AppError("CONFLICT", "assemblies.errors.closed");
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

/** Deletes a draft (nothing was sent yet) with its agenda; convened assemblies stay. */
export async function deleteAssembly(ctx: TenantCtx, assemblyId: string) {
  assertCan(ctx, "assembly:update");
  return withTenant(ctx, async (tx) => {
    const assembly = await loadAssembly(tx, assemblyId);
    assertDraft(assembly);
    await tx.delete(assemblyResolution).where(eq(assemblyResolution.assemblyId, assembly.id));
    await tx.delete(generalAssembly).where(eq(generalAssembly.id, assembly.id));
    return { residenceId: assembly.residenceId };
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
 * worker. Needs at least one resolution. Audited.
 */
export async function conveneAssembly(ctx: TenantCtx, assemblyId: string) {
  assertCan(ctx, "assembly:update");
  await withTenant(ctx, async (tx) => {
    const assembly = await loadAssembly(tx, assemblyId);
    assertDraft(assembly);
    const agenda = await tx
      .select({ title: assemblyResolution.title, majority: assemblyResolution.majority })
      .from(assemblyResolution)
      .where(eq(assemblyResolution.assemblyId, assembly.id))
      .orderBy(asc(assemblyResolution.position));
    if (agenda.length === 0) throw new AppError("CONFLICT", "assemblies.errors.emptyAgenda");
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
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "assembly.convene",
      entityType: "general_assembly",
      entityId: assembly.id,
      after: {
        kind: assembly.kind,
        heldOn: assembly.heldOn,
        startTime: assembly.startTime,
        place: assembly.place,
        agenda,
      },
    });
  });
}

/** Units of the residence with their current tantièmes and main co-owner on the meeting day. */
async function sheetUnits(tx: Tx, assembly: { residenceId: string; heldOn: string }) {
  const units = await tx
    .select({ unitId: residenceUnit.unitId, share: residenceUnit.share })
    .from(residenceUnit)
    .where(eq(residenceUnit.residenceId, assembly.residenceId));
  const owners = await mainCoOwners(tx, assembly.residenceId, assembly.heldOn);
  return units.map((u) => {
    const owner = owners.get(u.unitId);
    return { ...u, coOwnerName: owner ? `${owner.lastName} ${owner.firstName}` : null };
  });
}

/**
 * Records the attendance sheet as a whole: every unit of the residence is present, represented
 * by a proxy or absent (left out = absent), with its current tantièmes and main co-owner. The
 * votes of a unit that becomes absent are withdrawn.
 */
export async function saveAttendance(ctx: TenantCtx, input: In<typeof saveAttendanceSchema>) {
  assertCan(ctx, "assembly:update");
  return withTenant(ctx, async (tx) => {
    const assembly = await loadAssembly(tx, input.assemblyId);
    assertConvened(assembly);
    const units = await sheetUnits(tx, assembly);
    const rows = new Map(input.rows.map((row) => [row.unitId, row]));
    if (rows.size !== input.rows.length) throw invalid("rows", "assemblies.errors.duplicateUnit");
    for (const unitId of rows.keys()) {
      if (!units.some((u) => u.unitId === unitId)) {
        throw invalid("rows", "residences.errors.unitNotInResidence");
      }
    }
    const sheet = units.map((u) => {
      const row = rows.get(u.unitId);
      const kind = row?.kind ?? "absent";
      return {
        organizationId: ctx.orgId,
        assemblyId: assembly.id,
        residenceId: assembly.residenceId,
        unitId: u.unitId,
        kind,
        coOwnerName: u.coOwnerName,
        proxyName: kind === "represented" ? (row?.proxyName ?? null) : null,
        share: u.share,
      };
    });
    const absent = sheet.filter((s) => s.kind === "absent").map((s) => s.unitId);
    if (absent.length > 0) {
      await tx
        .delete(assemblyVote)
        .where(and(eq(assemblyVote.assemblyId, assembly.id), inArray(assemblyVote.unitId, absent)));
    }
    if (sheet.length > 0) {
      await tx
        .insert(assemblyAttendance)
        .values(sheet)
        .onConflictDoUpdate({
          target: [assemblyAttendance.assemblyId, assemblyAttendance.unitId],
          set: {
            kind: sql`excluded.kind`,
            coOwnerName: sql`excluded.co_owner_name`,
            proxyName: sql`excluded.proxy_name`,
            share: sql`excluded.share`,
          },
        });
    }
    const voting = sheet.filter((s) => votingKinds.includes(s.kind));
    return {
      voters: voting.length,
      shares: voting.reduce((sum, s) => sum + s.share, 0),
      totalShares: sheet.reduce((sum, s) => sum + s.share, 0),
    };
  });
}

/**
 * Records every vote of the assembly as a whole: one choice (for, against, abstain) per
 * resolution and present or represented unit; a unit without a choice did not vote.
 */
export async function saveVotes(ctx: TenantCtx, input: In<typeof saveVotesSchema>) {
  assertCan(ctx, "assembly:update");
  return withTenant(ctx, async (tx) => {
    const assembly = await loadAssembly(tx, input.assemblyId);
    assertConvened(assembly);
    const resolutions = await tx
      .select({ id: assemblyResolution.id })
      .from(assemblyResolution)
      .where(eq(assemblyResolution.assemblyId, assembly.id));
    const voters = await tx
      .select({ unitId: assemblyAttendance.unitId })
      .from(assemblyAttendance)
      .where(
        and(
          eq(assemblyAttendance.assemblyId, assembly.id),
          inArray(assemblyAttendance.kind, [...votingKinds]),
        ),
      );
    const seen = new Set<string>();
    for (const vote of input.votes) {
      if (!resolutions.some((r) => r.id === vote.resolutionId)) throw new AppError("NOT_FOUND");
      if (!voters.some((v) => v.unitId === vote.unitId)) {
        throw invalid("votes", "assemblies.errors.notVoting");
      }
      const key = `${vote.resolutionId}:${vote.unitId}`;
      if (seen.has(key)) throw invalid("votes", "assemblies.errors.duplicateVote");
      seen.add(key);
    }
    await tx.delete(assemblyVote).where(eq(assemblyVote.assemblyId, assembly.id));
    if (input.votes.length > 0) {
      await tx
        .insert(assemblyVote)
        .values(
          input.votes.map((v) => ({ ...v, organizationId: ctx.orgId, assemblyId: assembly.id })),
        );
    }
    return { votes: input.votes.length };
  });
}

/**
 * Closes a held assembly: the attendance sheet (tantièmes, co-owners), the residence's total
 * tantièmes, each resolution's tallies and result are frozen; the bilingual minutes are rendered
 * by the worker. Final; audited.
 */
export async function closeAssembly(ctx: TenantCtx, input: In<typeof closeAssemblySchema>) {
  assertCan(ctx, "assembly:update");
  return withTenant(ctx, async (tx) => {
    const assembly = await loadAssembly(tx, input.assemblyId);
    assertConvened(assembly);
    if (assembly.heldOn > todayInAlgiers()) {
      throw new AppError("CONFLICT", "assemblies.errors.notHeldYet");
    }
    const [taken] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(assemblyAttendance)
      .where(eq(assemblyAttendance.assemblyId, assembly.id));
    if (!taken?.n) throw new AppError("CONFLICT", "assemblies.errors.noAttendance");
    // The sheet is frozen with the residence's tantièmes and co-owners; a unit that joined the
    // residence after the sheet was taken was absent.
    const units = await sheetUnits(tx, assembly);
    if (units.length > 0) {
      await tx
        .insert(assemblyAttendance)
        .values(
          units.map((u) => ({
            ...u,
            organizationId: ctx.orgId,
            assemblyId: assembly.id,
            residenceId: assembly.residenceId,
            kind: "absent" as const,
          })),
        )
        .onConflictDoUpdate({
          target: [assemblyAttendance.assemblyId, assemblyAttendance.unitId],
          set: { coOwnerName: sql`excluded.co_owner_name`, share: sql`excluded.share` },
        });
    }
    const totalShares = units.reduce((sum, u) => sum + u.share, 0);
    const votes = await tx
      .select({
        resolutionId: assemblyVote.resolutionId,
        choice: assemblyVote.choice,
        share: assemblyAttendance.share,
      })
      .from(assemblyVote)
      .innerJoin(
        assemblyAttendance,
        and(
          eq(assemblyAttendance.assemblyId, assemblyVote.assemblyId),
          eq(assemblyAttendance.unitId, assemblyVote.unitId),
        ),
      )
      .where(eq(assemblyVote.assemblyId, assembly.id));
    const resolutions = await tx
      .select({
        id: assemblyResolution.id,
        position: assemblyResolution.position,
        majority: assemblyResolution.majority,
      })
      .from(assemblyResolution)
      .where(eq(assemblyResolution.assemblyId, assembly.id))
      .orderBy(asc(assemblyResolution.position));
    const results = resolutions.map((r) => {
      const tally = tallyVotes(votes.filter((v) => v.resolutionId === r.id));
      return { ...r, ...tally, adopted: isAdopted(r.majority, tally, totalShares) };
    });
    for (const r of results) {
      await tx
        .update(assemblyResolution)
        .set({
          sharesFor: r.for,
          sharesAgainst: r.against,
          sharesAbstain: r.abstain,
          adopted: r.adopted,
        })
        .where(eq(assemblyResolution.id, r.id));
    }
    const { assemblyId, ...bureau } = input;
    await tx
      .update(generalAssembly)
      .set({ ...bureau, status: "closed", closedAt: new Date(), totalShares })
      .where(eq(generalAssembly.id, assemblyId));
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "assembly_minutes", id: assembly.id },
      { singletonKey: `assembly_minutes:${assembly.id}` },
    );
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "assembly.close",
      entityType: "general_assembly",
      entityId: assembly.id,
      after: {
        ...bureau,
        totalShares,
        results: results.map((r) => ({
          position: r.position,
          majority: r.majority,
          for: r.for,
          against: r.against,
          abstain: r.abstain,
          adopted: r.adopted,
        })),
      },
    });
    return { adopted: results.filter((r) => r.adopted).length, resolutions: results.length };
  });
}
