import "server-only";

import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import { cashCount, treasuryAccount, treasuryMovement } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { todayInAlgiers } from "@/lib/dates";
import { AppError } from "@/lib/result";
import type { PaymentMethod } from "@/lib/sales";
import { accountKindsFor, defaultKindFor, type TreasuryAccountKind } from "@/lib/treasury";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { balanceOn } from "./balances";
import type {
  cancelMovementSchema,
  cashCountSchema,
  closeAccountSchema,
  createAccountSchema,
  recordMovementSchema,
  updateAccountSchema,
} from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

async function loadAccount(tx: Tx, accountId: string, options: { forUpdate?: boolean } = {}) {
  const query = tx.select().from(treasuryAccount).where(eq(treasuryAccount.id, accountId));
  const [row] = options.forUpdate ? await query.for("update") : await query;
  if (!row) throw new AppError("NOT_FOUND");
  return row;
}

/** The kind's current default loses its flag (one default per kind among open accounts). */
async function clearDefault(tx: Tx, kind: TreasuryAccountKind) {
  await tx
    .update(treasuryAccount)
    .set({ isDefault: false, updatedAt: new Date() })
    .where(and(eq(treasuryAccount.kind, kind), eq(treasuryAccount.isDefault, true)));
}

/**
 * Where a collection lands (CLAUDE.md §7 Treasury): the account chosen — open, of a kind the
 * method fits (cash in a cash desk; cheques, transfers, CCP, loans and cards in a bank or CCP
 * account) — else the default account of the method's kind (a CCP payment falls back on the
 * default bank account); null when the organization keeps no accounts.
 */
export async function resolvePaymentAccount(
  tx: Tx,
  method: PaymentMethod,
  accountId: string | null | undefined,
): Promise<string | null> {
  const kinds = accountKindsFor(method);
  if (accountId) {
    const [row] = await tx
      .select({ kind: treasuryAccount.kind, closedOn: treasuryAccount.closedOn })
      .from(treasuryAccount)
      .where(eq(treasuryAccount.id, accountId));
    if (!row || row.closedOn !== null) throw invalid("accountId", "treasury.errors.accountClosed");
    if (!kinds.includes(row.kind)) throw invalid("accountId", "treasury.errors.accountKind");
    return accountId;
  }
  const defaults = await tx
    .select({ id: treasuryAccount.id, kind: treasuryAccount.kind })
    .from(treasuryAccount)
    .where(and(eq(treasuryAccount.isDefault, true), isNull(treasuryAccount.closedOn)));
  const preferred = [defaultKindFor(method), ...kinds];
  for (const kind of preferred) {
    const found = defaults.find((d) => d.kind === kind);
    if (found) return found.id;
  }
  return null;
}

/** Opens a cash desk or an account (`treasury:update`), audited. */
export async function createAccount(ctx: TenantCtx, input: In<typeof createAccountSchema>) {
  assertCan(ctx, "treasury:update");
  if (input.openingOn > todayInAlgiers()) throw invalid("openingOn", "sales.errors.futureDate");
  return withTenant(ctx, async (tx) => {
    if (input.isDefault) await clearDefault(tx, input.kind);
    const [row] = await tx
      .insert(treasuryAccount)
      .values({
        organizationId: ctx.orgId,
        kind: input.kind,
        name: input.name,
        bankName: input.kind === "cash" ? null : input.bankName,
        accountNumber: input.kind === "cash" ? null : input.accountNumber,
        openingBalance: input.openingBalance,
        openingOn: input.openingOn,
        isDefault: input.isDefault,
        notes: input.notes,
        createdBy: ctx.userId,
      })
      .returning({ id: treasuryAccount.id });
    if (!row) throw new Error("createAccount: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "treasury_account.create",
      entityType: "treasury_account",
      entityId: row.id,
      after: { ...input },
    });
    return { id: row.id };
  });
}

/** Renames an account, its bank details, default flag or notes (opening balance fixed). */
export async function updateAccount(ctx: TenantCtx, input: In<typeof updateAccountSchema>) {
  assertCan(ctx, "treasury:update");
  await withTenant(ctx, async (tx) => {
    const current = await loadAccount(tx, input.accountId, { forUpdate: true });
    if (current.closedOn !== null) throw new AppError("CONFLICT", "treasury.errors.closed");
    if (input.isDefault && !current.isDefault) await clearDefault(tx, current.kind);
    const after = {
      name: input.name,
      bankName: current.kind === "cash" ? null : input.bankName,
      accountNumber: current.kind === "cash" ? null : input.accountNumber,
      isDefault: input.isDefault,
      notes: input.notes,
    };
    await tx
      .update(treasuryAccount)
      .set({ ...after, updatedAt: new Date() })
      .where(eq(treasuryAccount.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "treasury_account.update",
      entityType: "treasury_account",
      entityId: current.id,
      before: {
        name: current.name,
        bankName: current.bankName,
        accountNumber: current.accountNumber,
        isDefault: current.isDefault,
        notes: current.notes,
      },
      after,
    });
  });
}

/**
 * Closes an account: its balance must be nil on the closing day (transfer the rest first);
 * it then takes no new money and is no longer a default.
 */
export async function closeAccount(ctx: TenantCtx, input: In<typeof closeAccountSchema>) {
  assertCan(ctx, "treasury:update");
  const today = todayInAlgiers();
  if (input.closedOn > today) throw invalid("closedOn", "sales.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const current = await loadAccount(tx, input.accountId, { forUpdate: true });
    if (current.closedOn !== null) throw new AppError("CONFLICT", "treasury.errors.closed");
    if (input.closedOn < current.openingOn) {
      throw invalid("closedOn", "treasury.errors.beforeOpening");
    }
    const balance = await balanceOn(tx, current.id, today);
    if (balance !== 0n) throw new AppError("CONFLICT", "treasury.errors.balanceNotNil");
    await tx
      .update(treasuryAccount)
      .set({ closedOn: input.closedOn, isDefault: false, updatedAt: new Date() })
      .where(eq(treasuryAccount.id, current.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "treasury_account.close",
      entityType: "treasury_account",
      entityId: current.id,
      after: { closedOn: input.closedOn },
    });
  });
}

/** An open account on which money can move on that day. */
async function usableAccount(tx: Tx, accountId: string, on: string, field: string) {
  const account = await loadAccount(tx, accountId, { forUpdate: true });
  if (account.closedOn !== null) throw invalid(field, "treasury.errors.accountClosed");
  if (on < account.openingOn) throw invalid("movedOn", "treasury.errors.beforeOpening");
  return account;
}

/**
 * Records a manual movement (`treasury:update`): an income, an expense or a bank fee on one
 * account, or a transfer (two rows sharing a `transferId`: out of one account, into the other —
 * e.g. the cash desk's takings paid into the bank). Never in the future; audited.
 */
export async function recordMovement(ctx: TenantCtx, input: In<typeof recordMovementSchema>) {
  assertCan(ctx, "treasury:update");
  if (input.movedOn > todayInAlgiers()) throw invalid("movedOn", "sales.errors.futureDate");
  return withTenant(ctx, async (tx) => {
    const account = await usableAccount(tx, input.accountId, input.movedOn, "accountId");
    const common = {
      organizationId: ctx.orgId,
      amount: input.amount,
      movedOn: input.movedOn,
      label: input.label,
      category: input.category,
      reference: input.reference,
      createdBy: ctx.userId,
    };
    let ids: string[];
    if (input.kind === "transfer") {
      const target = await usableAccount(tx, input.toAccountId ?? "", input.movedOn, "toAccountId");
      const transferId = crypto.randomUUID();
      const rows = await tx
        .insert(treasuryMovement)
        .values([
          {
            ...common,
            accountId: account.id,
            kind: "transfer",
            direction: "out",
            transferId,
            counterAccountId: target.id,
          },
          {
            ...common,
            accountId: target.id,
            kind: "transfer",
            direction: "in",
            transferId,
            counterAccountId: account.id,
          },
        ])
        .returning({ id: treasuryMovement.id });
      ids = rows.map((r) => r.id);
    } else {
      const [row] = await tx
        .insert(treasuryMovement)
        .values({
          ...common,
          accountId: account.id,
          kind: input.kind,
          direction: input.kind === "income" ? "in" : "out",
        })
        .returning({ id: treasuryMovement.id });
      ids = row ? [row.id] : [];
    }
    const [first] = ids;
    if (!first) throw new Error("recordMovement: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "treasury_movement.create",
      entityType: "treasury_account",
      entityId: account.id,
      after: { ids, ...input },
    });
    return { id: first };
  });
}

/**
 * Cancels a manual movement with a reason (both sides of a transfer); a cash count's
 * adjustment stays (count again instead). Audited.
 */
export async function cancelMovement(ctx: TenantCtx, input: In<typeof cancelMovementSchema>) {
  assertCan(ctx, "treasury:update");
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select()
      .from(treasuryMovement)
      .where(eq(treasuryMovement.id, input.movementId))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    if (current.cancelledAt !== null) throw new AppError("CONFLICT", "treasury.errors.cancelled");
    if (current.kind === "adjustment") {
      throw new AppError("CONFLICT", "treasury.errors.adjustment");
    }
    const set = {
      cancelledAt: new Date(),
      cancelledBy: ctx.userId,
      cancellationReason: input.reason,
    };
    await tx
      .update(treasuryMovement)
      .set(set)
      .where(
        current.transferId
          ? eq(treasuryMovement.transferId, current.transferId)
          : eq(treasuryMovement.id, current.id),
      );
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "treasury_movement.cancel",
      entityType: "treasury_account",
      entityId: current.accountId,
      before: {
        id: current.id,
        kind: current.kind,
        amount: current.amount,
        movedOn: current.movedOn,
        label: current.label,
      },
      reason: input.reason,
    });
  });
}

/**
 * Arrêté de caisse (`treasury:count`): the cash counted in a cash desk on a day (not in the
 * future) against the ledger's balance that day; a difference needs a note and is booked as an
 * adjustment movement, so the ledger follows the cash actually there. Audited.
 */
export async function recordCashCount(ctx: TenantCtx, input: In<typeof cashCountSchema>) {
  assertCan(ctx, "treasury:count");
  if (input.countedOn > todayInAlgiers()) throw invalid("countedOn", "sales.errors.futureDate");
  return withTenant(ctx, async (tx) => {
    const account = await usableAccount(tx, input.accountId, input.countedOn, "accountId");
    if (account.kind !== "cash") throw new AppError("CONFLICT", "treasury.errors.notCash");
    const expected = await balanceOn(tx, account.id, input.countedOn);
    const difference = input.counted - expected;
    if (difference !== 0n && input.note === null) {
      throw invalid("note", "treasury.errors.differenceNote");
    }
    let adjustmentId: string | null = null;
    if (difference !== 0n) {
      const [adjustment] = await tx
        .insert(treasuryMovement)
        .values({
          organizationId: ctx.orgId,
          accountId: account.id,
          kind: "adjustment",
          direction: difference > 0n ? "in" : "out",
          amount: difference > 0n ? difference : -difference,
          movedOn: input.countedOn,
          label: input.note ?? "",
          createdBy: ctx.userId,
        })
        .returning({ id: treasuryMovement.id });
      adjustmentId = adjustment?.id ?? null;
    }
    const [row] = await tx
      .insert(cashCount)
      .values({
        organizationId: ctx.orgId,
        accountId: account.id,
        countedOn: input.countedOn,
        expected,
        counted: input.counted,
        difference,
        note: input.note,
        adjustmentId,
        countedBy: ctx.userId,
      })
      .returning({ id: cashCount.id });
    if (!row) throw new Error("recordCashCount: no row returned");
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "cash_count.create",
      entityType: "treasury_account",
      entityId: account.id,
      after: { countedOn: input.countedOn, expected, counted: input.counted, difference },
      reason: input.note ?? undefined,
    });
    return { id: row.id, expected, difference };
  });
}
