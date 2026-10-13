import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { and, count, desc, eq, gt, isNull, type SQL, sql } from "drizzle-orm";

import { consoleDb, type ConsoleTx } from "@/db/console-client";
import { accountOrganization, billingAccount, plan, provision, subscription } from "@/db/schema";
import { env } from "@/env";
import { enqueue } from "@/jobs/enqueue";
import { addDays, todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import type { SubscriptionProgram } from "@/lib/subscriptions";
import { provisionEmail } from "@/server/email/templates";

import { attachOrganization, openBillingAccount, PILOT_DAYS } from "./accounts";
import { recordConsoleAudit } from "./audit";
import { type OperatorCtx, systemOperator } from "./context";

/** A provision link stays valid this long (CLAUDE.console.md §3). */
export const PROVISION_DAYS = 14;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const normalize = (email: string) => email.trim().toLowerCase();

/** The link a provision's e-mail carries: sign up (e-mail prefilled), then onboard. */
export const provisionUrl = (token: string) =>
  `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/fr/sign-up?provision=${encodeURIComponent(token)}`;

export type ProvisionInput = {
  email: string;
  legalName: string;
  /** Another SARL of this client; null: a new client. */
  billingAccountId: string | null;
  /** For a new client (another SARL takes its account's plan). */
  planCode: string | null;
  program: SubscriptionProgram;
  pilotDays: number | null;
};

/**
 * Prepares a promoter's access (CLAUDE.console.md §8): a single-use link e-mailed (bilingual,
 * queued) to sign up and create its organization — a new client piloting a plan, or another SARL
 * joining an existing account within its plan's `organizations` cap. Only the token's SHA-256 is
 * kept; the link is returned once (to copy into a message). Audited `provision.create`.
 */
export async function createProvision(
  ctx: OperatorCtx,
  input: ProvisionInput,
  tx?: ConsoleTx,
): Promise<{ id: string; url: string }> {
  const run = async (trx: ConsoleTx) => {
    let planId: string;
    if (input.billingAccountId) {
      const [account] = await trx
        .select({
          planId: subscription.planId,
          limits: plan.limits,
          overrides: subscription.limitOverrides,
        })
        .from(subscription)
        .innerJoin(plan, eq(plan.id, subscription.planId))
        .where(eq(subscription.billingAccountId, input.billingAccountId));
      if (!account) throw new AppError("NOT_FOUND", "console.errors.accountUnknown");
      const cap = { ...account.limits, ...account.overrides }.organizations;
      const [held] = await trx
        .select({ n: count() })
        .from(accountOrganization)
        .where(eq(accountOrganization.billingAccountId, input.billingAccountId));
      if (cap !== null && (held?.n ?? 0) + 1 > cap) {
        throw new AppError("CONFLICT", "console.errors.organizationsCap", { details: { cap } });
      }
      planId = account.planId;
    } else {
      const [chosen] = await trx
        .select({ id: plan.id })
        .from(plan)
        .where(and(eq(plan.code, input.planCode ?? ""), isNull(plan.archivedAt)));
      if (!chosen) throw new AppError("NOT_FOUND", "console.errors.planUnknown");
      planId = chosen.id;
    }
    const token = `prv_${randomBytes(32).toString("base64url")}`;
    const expiresAt = new Date(Date.now() + PROVISION_DAYS * 86_400_000);
    const email = normalize(input.email);
    const [row] = await trx
      .insert(provision)
      .values({
        tokenHash: hash(token),
        email,
        legalName: input.legalName,
        billingAccountId: input.billingAccountId,
        planId,
        program: input.program,
        pilotDays: input.pilotDays ?? PILOT_DAYS[input.program],
        expiresAt,
        createdBy: ctx.userId,
      })
      .returning({ id: provision.id });
    if (!row) throw new Error("createProvision: no row");
    const url = provisionUrl(token);
    await enqueue(
      "email.send",
      provisionEmail({ to: email, organization: input.legalName, url, expiresAt }),
    );
    await recordConsoleAudit(trx, ctx, {
      action: "provision.create",
      billingAccountId: input.billingAccountId,
      after: { email, legalName: input.legalName, planId, program: input.program },
    });
    return { id: row.id, url };
  };
  return tx ? run(tx) : consoleDb.transaction(run);
}

/** Locks a provision row (on its own: Postgres refuses a schema-qualified `FOR UPDATE OF`). */
async function lockProvision(tx: ConsoleTx, where: SQL) {
  const [row] = await tx.select().from(provision).where(where).for("update");
  if (!row) return null;
  const [chosen] = await tx.select({ code: plan.code }).from(plan).where(eq(plan.id, row.planId));
  return { provision: row, planCode: chosen?.code ?? "" };
}

/** Withdraws a provision not used yet. Audited. */
export async function revokeProvision(ctx: OperatorCtx, provisionId: string): Promise<void> {
  await consoleDb.transaction(async (tx) => {
    const [row] = await tx
      .update(provision)
      .set({ revokedAt: new Date() })
      .where(
        and(eq(provision.id, provisionId), isNull(provision.usedAt), isNull(provision.revokedAt)),
      )
      .returning({ email: provision.email, billingAccountId: provision.billingAccountId });
    if (!row) throw new AppError("CONFLICT", "console.errors.provisionClosed");
    await recordConsoleAudit(tx, ctx, {
      action: "provision.revoke",
      billingAccountId: row.billingAccountId,
      after: { email: row.email },
    });
  });
}

/** Sends a provision again: a new link, the old one revoked (the token is never kept). */
export async function resendProvision(ctx: OperatorCtx, provisionId: string) {
  return consoleDb.transaction(async (tx) => {
    const old = await lockProvision(tx, eq(provision.id, provisionId));
    if (!old || old.provision.usedAt)
      throw new AppError("CONFLICT", "console.errors.provisionClosed");
    await tx
      .update(provision)
      .set({ revokedAt: old.provision.revokedAt ?? new Date() })
      .where(eq(provision.id, provisionId));
    return createProvision(
      ctx,
      {
        email: old.provision.email,
        legalName: old.provision.legalName,
        billingAccountId: old.provision.billingAccountId,
        planCode: old.planCode,
        program: old.provision.program,
        pilotDays: old.provision.pilotDays,
      },
      tx,
    );
  });
}

/** A provision link still valid (not used, revoked nor expired), or null. */
export async function findLiveProvision(token: string | null | undefined) {
  if (!token?.startsWith("prv_")) return null;
  const [row] = await consoleDb
    .select({
      id: provision.id,
      email: provision.email,
      legalName: provision.legalName,
      billingAccountId: provision.billingAccountId,
    })
    .from(provision)
    .where(
      and(
        eq(provision.tokenHash, hash(token)),
        isNull(provision.usedAt),
        isNull(provision.revokedAt),
        gt(provision.expiresAt, new Date()),
      ),
    );
  return row ?? null;
}

/** Whether this e-mail may sign up thanks to a live provision (the closed sign-up, §8). */
export async function hasLiveProvisionFor(email: string): Promise<boolean> {
  const [row] = await consoleDb
    .select({ id: provision.id })
    .from(provision)
    .where(
      and(
        eq(provision.email, normalize(email)),
        isNull(provision.usedAt),
        isNull(provision.revokedAt),
        gt(provision.expiresAt, new Date()),
      ),
    )
    .limit(1);
  return Boolean(row);
}

/**
 * The organization just created with a provision gets its account (CLAUDE.console.md §8): a new
 * client's billing account piloting the provision's plan, or a place in the existing account (its
 * cap checked again). The provision must be live and for the signed-in e-mail; it is used once.
 * Audited `provision.use`.
 */
export async function completeProvision(input: {
  token: string;
  organizationId: string;
  email: string;
}): Promise<{ billingAccountId: string }> {
  return consoleDb.transaction(async (tx) => {
    const row = await lockProvision(tx, eq(provision.tokenHash, hash(input.token)));
    const live =
      row &&
      !row.provision.usedAt &&
      !row.provision.revokedAt &&
      row.provision.expiresAt.getTime() > Date.now();
    if (!row || !live) throw new AppError("CONFLICT", "console.errors.provisionClosed");
    if (row.provision.email !== normalize(input.email)) {
      throw new AppError("FORBIDDEN", "console.errors.provisionEmail");
    }
    let billingAccountId = row.provision.billingAccountId;
    if (billingAccountId) {
      await attachOrganization(
        systemOperator,
        { billingAccountId, organizationId: input.organizationId },
        tx,
      );
    } else {
      ({ billingAccountId } = await openBillingAccount(
        systemOperator,
        {
          legalName: row.provision.legalName,
          contactName: null,
          email: row.provision.email,
          phone: null,
          organizationIds: [input.organizationId],
          planCode: row.planCode,
          status: "pilot",
          program: row.provision.program,
          billingPeriod: "yearly",
          price: null,
          pilotEndsOn: addDays(todayInAlgiers(), row.provision.pilotDays),
          currentPeriodStart: null,
          currentPeriodEnd: null,
          priceLockedUntil: null,
          addons: [],
          notes: null,
        },
        tx,
      ));
    }
    await tx
      .update(provision)
      .set({ usedAt: new Date(), organizationId: input.organizationId })
      .where(eq(provision.id, row.provision.id));
    await recordConsoleAudit(tx, systemOperator, {
      action: "provision.use",
      billingAccountId,
      organizationId: input.organizationId,
      after: { email: row.provision.email },
    });
    return { billingAccountId };
  });
}

/** The provisions, latest first, with their state; for the console's page and to-dos. */
export async function listProvisions(_ctx: OperatorCtx) {
  return consoleDb
    .select({
      id: provision.id,
      email: provision.email,
      legalName: provision.legalName,
      program: provision.program,
      planNameFr: plan.nameFr,
      planNameAr: plan.nameAr,
      billingAccountId: provision.billingAccountId,
      accountName: billingAccount.legalName,
      createdAt: provision.createdAt,
      expiresAt: provision.expiresAt,
      usedAt: provision.usedAt,
      revokedAt: provision.revokedAt,
      state: sql<"used" | "revoked" | "expired" | "live">`case
        when ${provision.usedAt} is not null then 'used'
        when ${provision.revokedAt} is not null then 'revoked'
        when ${provision.expiresAt} <= now() then 'expired'
        else 'live' end`,
    })
    .from(provision)
    .innerJoin(plan, eq(plan.id, provision.planId))
    .leftJoin(billingAccount, eq(billingAccount.id, provision.billingAccountId))
    .orderBy(desc(provision.createdAt))
    .limit(200);
}
