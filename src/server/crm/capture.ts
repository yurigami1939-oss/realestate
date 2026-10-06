import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { z } from "zod";

import { leadCaptureKey, member, project, user } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { env } from "@/env";
import { parseRoles } from "@/lib/permissions";
import { AppError } from "@/lib/result";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { assertLiveProject } from "./access";
import { createLead } from "./leads";
import {
  type capturedLeadSchema,
  type captureKeyIdSchema,
  createLeadSchema,
  type createCaptureKeySchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Leads a key may send per minute (a form spammed stops quickly). */
export const CAPTURE_PER_MINUTE = 30;

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

/**
 * A capture key for a website form or an automation (managers: `lead:assign`). The key is
 * shown once; only its SHA-256 is kept. Audited.
 */
export async function createCaptureKey(ctx: TenantCtx, input: In<typeof createCaptureKeySchema>) {
  assertCan(ctx, "lead:assign");
  const key = `lck_${randomBytes(24).toString("base64url")}`;
  return withTenant(ctx, async (tx) => {
    if (input.projectId) await assertLiveProject(tx, input.projectId);
    const [row] = await tx
      .insert(leadCaptureKey)
      .values({
        organizationId: ctx.orgId,
        name: input.name,
        prefix: key.slice(0, 12),
        keyHash: hash(key),
        source: input.source,
        projectId: input.projectId,
        createdBy: ctx.userId,
      })
      .returning({ id: leadCaptureKey.id });
    if (!row) throw new Error("createCaptureKey: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.capture_key",
      entityType: "organization",
      entityId: ctx.orgId,
      after: { name: input.name, prefix: key.slice(0, 12), source: input.source },
    });
    return { id: row.id, key };
  });
}

/** A key stops working at once; kept in the list. Audited. */
export async function revokeCaptureKey(ctx: TenantCtx, input: In<typeof captureKeyIdSchema>) {
  assertCan(ctx, "lead:assign");
  await withTenant(ctx, async (tx) => {
    const [row] = await tx
      .update(leadCaptureKey)
      .set({ revokedAt: new Date(), revokedBy: ctx.userId })
      .where(and(eq(leadCaptureKey.id, input.keyId), isNull(leadCaptureKey.revokedAt)))
      .returning({ name: leadCaptureKey.name, prefix: leadCaptureKey.prefix });
    if (!row) throw new AppError("NOT_FOUND");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "organization.capture_key_revoke",
      entityType: "organization",
      entityId: ctx.orgId,
      after: row,
    });
  });
}

const creator = alias(user, "creator");

/** The organization's capture keys (managers), newest first. */
export async function listCaptureKeys(ctx: TenantCtx) {
  assertCan(ctx, "lead:assign");
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: leadCaptureKey.id,
        name: leadCaptureKey.name,
        prefix: leadCaptureKey.prefix,
        source: leadCaptureKey.source,
        projectName: project.name,
        createdByName: creator.name,
        createdAt: leadCaptureKey.createdAt,
        lastUsedAt: leadCaptureKey.lastUsedAt,
        revokedAt: leadCaptureKey.revokedAt,
      })
      .from(leadCaptureKey)
      .innerJoin(creator, eq(creator.id, leadCaptureKey.createdBy))
      .leftJoin(project, eq(project.id, leadCaptureKey.projectId))
      .orderBy(desc(leadCaptureKey.createdAt)),
  );
}

export type CaptureKeyRow = Awaited<ReturnType<typeof listCaptureKeys>>[number];

/**
 * `POST /api/v1/organizations/{orgId}/leads`: a lead sent with a live key of the organization
 * is created as the member who made the key (still a member who may create leads), with the
 * key's source and project unless the call gives them; duplicates are flagged as by hand.
 * At most CAPTURE_PER_MINUTE calls per key and minute.
 */
export async function captureLead(
  orgId: string,
  rawKey: string | null,
  input: In<typeof capturedLeadSchema>,
) {
  if (!rawKey?.startsWith("lck_")) throw new AppError("UNAUTHENTICATED");
  return withTenant({ orgId }, async (tx) => {
    const [key] = await tx
      .select()
      .from(leadCaptureKey)
      .where(and(eq(leadCaptureKey.keyHash, hash(rawKey)), isNull(leadCaptureKey.revokedAt)))
      .for("update");
    if (!key) throw new AppError("UNAUTHENTICATED");
    const [updated] = await tx
      .update(leadCaptureKey)
      .set({
        lastUsedAt: new Date(),
        windowStart: sql`case when ${leadCaptureKey.windowStart} > now() - interval '1 minute' then ${leadCaptureKey.windowStart} else now() end`,
        windowCount: sql`case when ${leadCaptureKey.windowStart} > now() - interval '1 minute' then ${leadCaptureKey.windowCount} + 1 else 1 end`,
      })
      .where(eq(leadCaptureKey.id, key.id))
      .returning({ count: leadCaptureKey.windowCount });
    if ((updated?.count ?? 0) > CAPTURE_PER_MINUTE) {
      throw new AppError("CONFLICT", "capture.errors.tooMany");
    }
    // `member` is Better Auth's (no RLS): filter on the organization explicitly.
    const [membership] = await tx
      .select({ role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, orgId), eq(member.userId, key.createdBy)));
    if (!membership) throw new AppError("FORBIDDEN");
    const ctx: TenantCtx = {
      userId: key.createdBy,
      orgId,
      roles: parseRoles(membership.role),
      locale: "fr",
    };
    let projectId = key.projectId;
    if (input.project) {
      const [found] = await tx
        .select({ id: project.id })
        .from(project)
        .where(and(eq(project.code, input.project.toUpperCase()), isNull(project.deletedAt)));
      projectId = found?.id ?? projectId;
    }
    const created = await createLead(
      ctx,
      createLeadSchema.parse({
        fullName: input.fullName,
        phone: input.phone,
        phone2: "",
        email: input.email ?? "",
        city: input.city ?? "",
        source: input.source ?? key.source,
        sourceDetail: input.sourceDetail ?? key.name,
        projectId: projectId ?? "",
        typologies: [],
        budget: "",
        financing: "",
        notes: input.message ?? "",
        assignedTo: "",
      }),
      tx,
    );
    return { id: created.id, duplicate: created.duplicates > 0 };
  });
}

/** Where websites and automations post their leads. */
export function captureEndpoint(orgId: string) {
  return `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/v1/organizations/${orgId}/leads`;
}
