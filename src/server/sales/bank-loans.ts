import "server-only";

import { and, desc, eq, ne, notInArray, sql } from "drizzle-orm";
import type { z } from "zod";

import { bankLoan, payment } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { isUuid } from "@/lib/ids";
import { AppError } from "@/lib/result";
import { assertCan, type TenantCtx } from "@/server/auth/session";

import { loadVisibleReservation } from "./access";
import type { createBankLoanSchema, updateBankLoanSchema } from "./schemas";

type In<S extends z.ZodType> = z.output<S>;

/** Loans that are still being followed (refused and cancelled ones are history). */
const closedLoan = ["refused", "cancelled"] as const;

function checkLoan(input: In<typeof createBankLoanSchema> | In<typeof updateBankLoanSchema>) {
  if (input.requested <= 0n) {
    throw new AppError("VALIDATION", "validation.amount", {
      fieldErrors: { requested: ["validation.amount"] },
    });
  }
  if (input.status === "approved" && input.approved === null) {
    throw new AppError("VALIDATION", "validation.required", {
      fieldErrors: { approved: ["validation.required"] },
    });
  }
}

/** Opens the bank loan file of a sale's buyer; one followed loan per sale. */
export async function createBankLoan(ctx: TenantCtx, input: In<typeof createBankLoanSchema>) {
  assertCan(ctx, "sale:update");
  checkLoan(input);
  return withTenant(ctx, async (tx) => {
    const sale = await loadVisibleReservation(tx, ctx, input.reservationId, { forUpdate: true });
    if (sale.status === "withdrawn") throw new AppError("CONFLICT", "sales.errors.closed");
    const [open] = await tx
      .select({ id: bankLoan.id })
      .from(bankLoan)
      .where(
        and(eq(bankLoan.reservationId, sale.id), notInArray(bankLoan.status, [...closedLoan])),
      );
    if (open) throw new AppError("CONFLICT", "sales.loan.errors.alreadyOpen");
    const { reservationId: _reservationId, ...fields } = input;
    const [row] = await tx
      .insert(bankLoan)
      .values({
        ...fields,
        organizationId: ctx.orgId,
        reservationId: sale.id,
        createdBy: ctx.userId,
      })
      .returning({ id: bankLoan.id });
    if (!row) throw new Error("createBankLoan: no row returned");
    return { id: row.id };
  });
}

/** Follows the loan file: submission, bank decision, approved amount, notes. */
export async function updateBankLoan(ctx: TenantCtx, input: In<typeof updateBankLoanSchema>) {
  assertCan(ctx, "sale:update");
  checkLoan(input);
  await withTenant(ctx, async (tx) => {
    const [current] = await tx
      .select({ reservationId: bankLoan.reservationId })
      .from(bankLoan)
      .where(eq(bankLoan.id, input.bankLoanId))
      .for("update");
    if (!current) throw new AppError("NOT_FOUND");
    await loadVisibleReservation(tx, ctx, current.reservationId, { forUpdate: true });
    if (!closedLoan.includes(input.status as (typeof closedLoan)[number])) {
      const [other] = await tx
        .select({ id: bankLoan.id })
        .from(bankLoan)
        .where(
          and(
            eq(bankLoan.reservationId, current.reservationId),
            ne(bankLoan.id, input.bankLoanId),
            notInArray(bankLoan.status, [...closedLoan]),
          ),
        );
      if (other) throw new AppError("CONFLICT", "sales.loan.errors.alreadyOpen");
    }
    const { bankLoanId: _id, ...fields } = input;
    await tx.update(bankLoan).set(fields).where(eq(bankLoan.id, input.bankLoanId));
  });
}

/**
 * Bank loans of a visible sale, followed one first, with what the bank has disbursed so far
 * (valid payments of the sale by `bank_loan`).
 */
export async function listSaleBankLoans(ctx: TenantCtx, reservationId: string) {
  assertCan(ctx, "sale:read");
  if (!isUuid(reservationId)) return { loans: [], disbursed: 0n };
  return withTenant(ctx, async (tx) => {
    await loadVisibleReservation(tx, ctx, reservationId);
    const loans = await tx
      .select({
        id: bankLoan.id,
        bank: bankLoan.bank,
        requested: bankLoan.requested,
        approved: bankLoan.approved,
        status: bankLoan.status,
        submittedOn: bankLoan.submittedOn,
        decidedOn: bankLoan.decidedOn,
        reference: bankLoan.reference,
        notes: bankLoan.notes,
      })
      .from(bankLoan)
      .where(eq(bankLoan.reservationId, reservationId))
      .orderBy(sql`${bankLoan.status} in ('refused', 'cancelled')`, desc(bankLoan.createdAt));
    const [row] = await tx
      .select({ total: sql<string>`coalesce(sum(${payment.amount}), 0)::text` })
      .from(payment)
      .where(
        and(
          eq(payment.reservationId, reservationId),
          eq(payment.method, "bank_loan"),
          eq(payment.status, "valid"),
        ),
      );
    return { loans, disbursed: BigInt(row?.total ?? "0") };
  });
}

export type SaleBankLoan = Awaited<ReturnType<typeof listSaleBankLoans>>["loans"][number];
