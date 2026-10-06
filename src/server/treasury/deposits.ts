import "server-only";

import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { z } from "zod";

import type { Tx } from "@/db/client";
import {
  chargePayment,
  chequeDeposit,
  chequeDepositItem,
  payment,
  rentPayment,
  treasuryAccount,
  user,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { enqueueInTx } from "@/jobs/enqueue";
import { type CalendarDate, todayInAlgiers } from "@/lib/dates";
import { isUuid } from "@/lib/ids";
import { type Centimes, sumCentimes } from "@/lib/money";
import { AppError } from "@/lib/result";
import type { ChequeSource } from "@/lib/treasury";
import { recordAudit } from "@/server/audit/record-audit";
import { assertCan, type TenantCtx } from "@/server/auth/session";
import { nextDocumentNumber } from "@/server/numbering/next-document-number";

import type { clearChequeDepositSchema, createChequeDepositSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

const invalid = (field: string, messageKey: string) =>
  new AppError("VALIDATION", messageKey, { fieldErrors: { [field]: [messageKey] } });

/** The three tables a cheque can be received in, with the columns a slip needs. */
const sources = {
  sale: payment,
  charges: chargePayment,
  rent: rentPayment,
} as const;

export type PendingCheque = {
  source: ChequeSource;
  paymentId: string;
  receivedOn: CalendarDate;
  amount: Centimes;
  chequeNumber: string | null;
  bank: string | null;
  payerName: string;
};

/**
 * Cheques received on an account, valid, not cleared and on no deposit slip yet (oldest first):
 * what the cashier takes to the bank.
 */
async function loadPendingCheques(tx: Tx, accountId: string): Promise<PendingCheque[]> {
  const rows: PendingCheque[] = [];
  for (const source of ["sale", "charges", "rent"] as const) {
    const table = sources[source];
    const found = await tx
      .select({
        paymentId: table.id,
        receivedOn: table.paidOn,
        amount: table.amount,
        chequeNumber: table.reference,
        bank: table.bank,
        payerName: table.payerName,
      })
      .from(table)
      .leftJoin(
        chequeDepositItem,
        and(eq(chequeDepositItem.source, source), eq(chequeDepositItem.paymentId, table.id)),
      )
      .where(
        and(
          eq(table.accountId, accountId),
          eq(table.method, "cheque"),
          eq(table.status, "valid"),
          isNull(table.chequeClearedOn),
          isNull(chequeDepositItem.id),
        ),
      );
    rows.push(...found.map((r) => ({ ...r, source })));
  }
  return rows.sort((a, b) =>
    a.receivedOn < b.receivedOn ? -1 : a.receivedOn > b.receivedOn ? 1 : 0,
  );
}

async function loadDepositAccount(tx: Tx, accountId: string) {
  const [account] = await tx
    .select()
    .from(treasuryAccount)
    .where(eq(treasuryAccount.id, accountId));
  if (!account) throw new AppError("NOT_FOUND");
  if (account.kind === "cash") throw new AppError("CONFLICT", "treasury.errors.depositOnCash");
  return account;
}

/** Cheques of a bank or CCP account still to hand to the bank (`treasury:read`). */
export async function listPendingCheques(ctx: TenantCtx, accountId: string) {
  assertCan(ctx, "treasury:read");
  if (!isUuid(accountId)) return [];
  return withTenant(ctx, (tx) => loadPendingCheques(tx, accountId));
}

/**
 * Bordereau de remise de chèques (`treasury:count`: gérant, comptable, caissier): some of the
 * account's pending cheques, handed to the bank on a day (from the latest cheque's receipt to
 * today). Numbered BRC-…, each cheque on one slip only, audited, bilingual PDF by the worker.
 */
export async function createChequeDeposit(
  ctx: TenantCtx,
  input: In<typeof createChequeDepositSchema>,
) {
  assertCan(ctx, "treasury:count");
  if (input.depositedOn > todayInAlgiers()) {
    throw invalid("depositedOn", "sales.errors.futureDate");
  }
  return withTenant(ctx, async (tx) => {
    const account = await loadDepositAccount(tx, input.accountId);
    if (account.closedOn !== null) throw new AppError("CONFLICT", "treasury.errors.accountClosed");
    // Lock the account so two slips never take the same cheque (the unique key also refuses it).
    await tx
      .select({ id: treasuryAccount.id })
      .from(treasuryAccount)
      .where(eq(treasuryAccount.id, account.id))
      .for("update");
    const pending = await loadPendingCheques(tx, account.id);
    const chosen = input.cheques.map((c) => {
      const cheque = pending.find((p) => p.source === c.source && p.paymentId === c.paymentId);
      if (!cheque) throw new AppError("CONFLICT", "treasury.errors.chequeNotPending");
      return cheque;
    });
    if (chosen.some((c) => c.receivedOn > input.depositedOn)) {
      throw invalid("depositedOn", "treasury.errors.depositBeforeCheque");
    }
    const total = sumCentimes(chosen.map((c) => c.amount));
    const { number } = await nextDocumentNumber(tx, ctx, "cheque_deposit");
    const [row] = await tx
      .insert(chequeDeposit)
      .values({
        organizationId: ctx.orgId,
        number,
        accountId: account.id,
        depositedOn: input.depositedOn,
        total,
        count: chosen.length,
        createdBy: ctx.userId,
      })
      .returning({ id: chequeDeposit.id });
    if (!row) throw new Error("createChequeDeposit: no row returned");
    await tx
      .insert(chequeDepositItem)
      .values(chosen.map((c) => ({ organizationId: ctx.orgId, depositId: row.id, ...c })));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "cheque_deposit.create",
      entityType: "treasury_account",
      entityId: account.id,
      after: { number, depositedOn: input.depositedOn, total, count: chosen.length },
    });
    await enqueueInTx(
      tx,
      "pdf.document",
      { organizationId: ctx.orgId, kind: "cheque_deposit", id: row.id },
      { singletonKey: row.id },
    );
    return { id: row.id, number, total };
  });
}

/**
 * The bank credited a slip (`payment:create`): its cheques still valid and not cleared are
 * cleared on that day (a bounced one is cancelled by the accountant first). Audited.
 */
export async function clearChequeDeposit(
  ctx: TenantCtx,
  input: In<typeof clearChequeDepositSchema>,
) {
  assertCan(ctx, "payment:create");
  if (input.clearedOn > todayInAlgiers()) throw invalid("clearedOn", "sales.errors.futureDate");
  await withTenant(ctx, async (tx) => {
    const [deposit] = await tx
      .select()
      .from(chequeDeposit)
      .where(eq(chequeDeposit.id, input.depositId))
      .for("update");
    if (!deposit) throw new AppError("NOT_FOUND");
    if (deposit.clearedOn) throw new AppError("CONFLICT", "treasury.errors.depositCleared");
    if (input.clearedOn < deposit.depositedOn) {
      throw invalid("clearedOn", "treasury.errors.clearedBeforeDeposit");
    }
    const items = await tx
      .select({ source: chequeDepositItem.source, paymentId: chequeDepositItem.paymentId })
      .from(chequeDepositItem)
      .where(eq(chequeDepositItem.depositId, deposit.id));
    let cleared = 0;
    for (const source of ["sale", "charges", "rent"] as const) {
      const ids = items.filter((i) => i.source === source).map((i) => i.paymentId);
      if (ids.length === 0) continue;
      const table = sources[source];
      const done = await tx
        .update(table)
        .set({ chequeClearedOn: input.clearedOn })
        .where(
          and(inArray(table.id, ids), eq(table.status, "valid"), isNull(table.chequeClearedOn)),
        )
        .returning({ id: table.id });
      cleared += done.length;
    }
    await tx
      .update(chequeDeposit)
      .set({ clearedOn: input.clearedOn })
      .where(eq(chequeDeposit.id, deposit.id));
    await recordAudit(tx, ctx, {
      actorUserId: ctx.userId,
      action: "cheque_deposit.clear",
      entityType: "treasury_account",
      entityId: deposit.accountId,
      after: { number: deposit.number, clearedOn: input.clearedOn, cleared },
    });
  });
}

/** Deposit slips of an account, newest first, with what is left to clear (`treasury:read`). */
export async function listChequeDeposits(ctx: TenantCtx, accountId: string) {
  assertCan(ctx, "treasury:read");
  if (!isUuid(accountId)) return [];
  return withTenant(ctx, (tx) =>
    tx
      .select({
        id: chequeDeposit.id,
        number: chequeDeposit.number,
        depositedOn: chequeDeposit.depositedOn,
        total: chequeDeposit.total,
        count: chequeDeposit.count,
        clearedOn: chequeDeposit.clearedOn,
        createdByName: user.name,
        pdfFileId: chequeDeposit.pdfFileId,
      })
      .from(chequeDeposit)
      .innerJoin(user, eq(user.id, chequeDeposit.createdBy))
      .where(eq(chequeDeposit.accountId, accountId))
      .orderBy(desc(chequeDeposit.depositedOn), desc(chequeDeposit.number))
      .limit(20),
  );
}

export type ChequeDepositRow = Awaited<ReturnType<typeof listChequeDeposits>>[number];

/** Everything printed on a slip (PDF job). */
export async function loadChequeDepositDocument(tx: Tx, depositId: string) {
  const [deposit] = await tx
    .select({
      deposit: chequeDeposit,
      accountName: treasuryAccount.name,
      bankName: treasuryAccount.bankName,
      accountNumber: treasuryAccount.accountNumber,
      accountKind: treasuryAccount.kind,
    })
    .from(chequeDeposit)
    .innerJoin(treasuryAccount, eq(treasuryAccount.id, chequeDeposit.accountId))
    .where(eq(chequeDeposit.id, depositId));
  if (!deposit) return null;
  const items = await tx
    .select()
    .from(chequeDepositItem)
    .where(eq(chequeDepositItem.depositId, depositId))
    .orderBy(asc(chequeDepositItem.receivedOn), asc(sql`${chequeDepositItem.id}`));
  return { ...deposit, items };
}
